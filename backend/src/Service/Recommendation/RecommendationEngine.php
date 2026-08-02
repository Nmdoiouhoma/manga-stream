<?php

declare(strict_types=1);

namespace App\Service\Recommendation;

use App\Entity\Anime;
use App\Entity\Favorite;
use App\Entity\Manga;
use App\Entity\Progress;
use App\Entity\Recommendation;
use App\Entity\User;
use App\Enum\ProgressStatus;
use Doctrine\ORM\EntityManagerInterface;

/**
 * Moteur de recommandation v2 — similarité cosinus sur genres pondérés par leur rareté.
 *
 * La v1 sommait les poids des genres communs et divisait par le poids du profil. Avec
 * peu de favoris, presque tout candidat couvrait l'intégralité du profil : le score
 * saturait à 1,0 pour la quasi-totalité des résultats, qui n'étaient donc plus classés.
 * Le calcul « fonctionnait » sans rien discriminer.
 *
 * La v2 corrige les trois causes :
 *
 *  1. **Rareté (IDF).** Un genre partagé n'a pas la même valeur selon sa fréquence dans
 *     le catalogue : « Action », présent partout, n'apprend presque rien ; « Psychological »
 *     est un signal fort. Chaque genre reçoit idf = ln(1 + N / df).
 *  2. **Cosinus.** Profil et candidat deviennent des vecteurs normalisés ; le score est
 *     leur produit scalaire. Normaliser *aussi* par le candidat pénalise les œuvres
 *     fourre-tout à quinze genres, qui recoupaient mécaniquement n'importe quel profil.
 *  3. **Départage par qualité.** Le cosinus seul produit encore des ex æquo ; une petite
 *     part de note moyenne et de popularité les sépare, sans jamais dominer l'affinité.
 *
 * Score final dans [0, 1] : 85 % d'affinité, 10 % de note, 5 % de popularité.
 *
 * Chaque recommandation porte son explication (`reason`) : genres décisifs classés par
 * contribution réelle, et détail des trois composantes. Restent hors périmètre : le
 * filtrage collaboratif (« ceux qui ont aimé X ont aimé Y ») et la récence.
 */
final readonly class RecommendationEngine
{
    /** Nombre de recommandations conservées par utilisateur. */
    public const LIMIT = 20;

    /** Durée au-delà de laquelle un jeu de recommandations est considéré périmé. */
    private const FRESHNESS_SECONDS = 3600;

    /** Répartition du score final entre affinité, qualité et notoriété. */
    private const WEIGHT_AFFINITY = 0.85;
    private const WEIGHT_SCORE = 0.10;
    private const WEIGHT_POPULARITY = 0.05;

    /** Note supposée d'une œuvre non notée : neutre, pour ne pas la punir. */
    private const NEUTRAL_SCORE = 65.0;

    public function __construct(private EntityManagerInterface $entityManager)
    {
    }

    /**
     * Régénère les recommandations si elles sont absentes, périmées, ou plus vieilles
     * que le dernier favori ajouté (pour qu'un nouveau favori se répercute aussitôt).
     *
     * @return bool true si un recalcul a eu lieu
     */
    public function refreshIfStale(User $user): bool
    {
        if (!$this->isStale($user)) {
            return false;
        }

        $this->generate($user);

        return true;
    }

    /**
     * Recalcule intégralement les recommandations de l'utilisateur.
     *
     * @return list<Recommendation>
     */
    public function generate(User $user): array
    {
        $this->clear($user);

        $profile = $this->tasteProfile($user);
        $totalWeight = array_sum($profile);

        if (0 === $totalWeight) {
            // Aucun favori : rien à extrapoler. On préfère une liste vide à des
            // suggestions arbitraires, qui donneraient une fausse impression de
            // personnalisation.
            $this->entityManager->flush();

            return [];
        }

        $excluded = $this->excludedIds($user);
        $genreIds = array_keys($profile);

        $idf = $this->inverseGenreFrequency();
        $maxPopularity = $this->maxPopularity();

        // Vecteur de goût : occurrences pondérées par la rareté, puis normalisé.
        $profileVector = [];
        foreach ($profile as $genreId => $occurrences) {
            $profileVector[$genreId] = $occurrences * ($idf[$genreId] ?? 0.0);
        }
        $profileNorm = $this->norm($profileVector);

        if (0.0 === $profileNorm) {
            // Cas limite : tous les genres du profil sont présents dans 100 % du
            // catalogue, donc d'IDF nul. Ils ne discriminent rien — mieux vaut ne rien
            // proposer qu'un classement arbitraire.
            $this->entityManager->flush();

            return [];
        }

        $scored = [];
        foreach ([Anime::class, Manga::class] as $class) {
            foreach ($this->candidates($class, $genreIds, $excluded[$class]) as $candidate) {
                $candidateVector = [];
                foreach ($candidate->getGenres() as $genre) {
                    $candidateVector[$genre->getId()] = $idf[$genre->getId()] ?? 0.0;
                }

                $candidateNorm = $this->norm($candidateVector);
                if (0.0 === $candidateNorm) {
                    continue;
                }

                // Cosinus : part du profil couverte, rapportée à l'ampleur du candidat.
                $dot = 0.0;
                $contributions = [];
                foreach ($candidateVector as $genreId => $value) {
                    if (!isset($profileVector[$genreId])) {
                        continue;
                    }
                    $product = $profileVector[$genreId] * $value;
                    $dot += $product;
                    $contributions[$genreId] = $product;
                }

                if (0.0 === $dot) {
                    continue;
                }

                $affinity = $dot / ($profileNorm * $candidateNorm);

                $quality = (($candidate->getAverageScore() ?? self::NEUTRAL_SCORE) / 100.0);
                $popularity = $this->popularityOf($candidate, $maxPopularity);

                $score = self::WEIGHT_AFFINITY * $affinity
                    + self::WEIGHT_SCORE * $quality
                    + self::WEIGHT_POPULARITY * $popularity;

                // Genres décisifs : ceux qui pèsent le plus dans le produit scalaire.
                arsort($contributions);
                $matched = [];
                foreach (array_slice(array_keys($contributions), 0, 4) as $genreId) {
                    foreach ($candidate->getGenres() as $genre) {
                        if ($genre->getId() === $genreId) {
                            $matched[] = $genre->getSlug();
                            break;
                        }
                    }
                }

                $scored[] = [
                    'entity' => $candidate,
                    'score' => min(1.0, max(0.0, $score)),
                    'affinity' => $affinity,
                    'quality' => $quality,
                    'popularity' => $popularity,
                    'genres' => $matched,
                ];
            }
        }

        // Score décroissant ; à score égal, le mieux noté du catalogue passe devant.
        usort($scored, static function (array $a, array $b): int {
            return [$b['score'], $b['entity']->getAverageScore() ?? 0]
                <=> [$a['score'], $a['entity']->getAverageScore() ?? 0];
        });

        $recommendations = [];
        foreach (\array_slice($scored, 0, self::LIMIT) as $item) {
            $recommendation = new Recommendation();
            $recommendation
                ->setUser($user)
                ->setScore(round($item['score'], 4))
                ->setReason([
                    'strategy' => 'genre_cosine_idf',
                    'genres' => $item['genres'],
                    'affinity' => round($item['affinity'], 4),
                    'quality' => round($item['quality'], 4),
                    'popularity' => round($item['popularity'], 4),
                ]);

            if ($item['entity'] instanceof Anime) {
                $recommendation->setAnime($item['entity']);
            } else {
                $recommendation->setManga($item['entity']);
            }

            $this->entityManager->persist($recommendation);
            $recommendations[] = $recommendation;
        }

        $this->entityManager->flush();

        return $recommendations;
    }

    /**
     * Rareté de chaque genre dans le catalogue : idf = ln(1 + N / df).
     *
     * Un genre porté par presque toutes les œuvres tend vers 0 (il n'apprend rien) ;
     * un genre rare monte. C'est ce qui empêche « Action » d'écraser le classement.
     *
     * @return array<int, float> genreId => idf
     */
    private function inverseGenreFrequency(): array
    {
        $documentFrequency = [];
        $total = 0;

        foreach ([Anime::class, Manga::class] as $class) {
            $total += (int) $this->entityManager->createQueryBuilder()
                ->select('COUNT(c.id)')
                ->from($class, 'c')
                ->getQuery()
                ->getSingleScalarResult();

            $rows = $this->entityManager->createQueryBuilder()
                ->select('g.id AS id', 'COUNT(c.id) AS df')
                ->from($class, 'c')
                ->join('c.genres', 'g')
                ->groupBy('g.id')
                ->getQuery()
                ->getArrayResult();

            foreach ($rows as $row) {
                $id = (int) $row['id'];
                $documentFrequency[$id] = ($documentFrequency[$id] ?? 0) + (int) $row['df'];
            }
        }

        if (0 === $total) {
            return [];
        }

        $idf = [];
        foreach ($documentFrequency as $genreId => $df) {
            // +1 au dénominateur : borne l'idf et évite la division par zéro.
            $idf[$genreId] = log(1 + $total / (1 + $df));
        }

        return $idf;
    }

    /** Popularité la plus élevée du catalogue, servant d'échelle de normalisation. */
    private function maxPopularity(): int
    {
        $max = 0;

        foreach ([Anime::class, Manga::class] as $class) {
            $value = $this->entityManager->createQueryBuilder()
                ->select('MAX(c.popularity)')
                ->from($class, 'c')
                ->getQuery()
                ->getSingleScalarResult();

            $max = max($max, (int) $value);
        }

        return $max;
    }

    /**
     * Popularité ramenée dans [0, 1] sur une échelle logarithmique.
     *
     * La popularité AniList suit une distribution à longue traîne : quelques titres
     * écrasent tous les autres. En linéaire, tout le catalogue serait tassé près de 0
     * et cette composante ne départagerait rien.
     */
    private function popularityOf(Anime|Manga $candidate, int $maxPopularity): float
    {
        if ($maxPopularity <= 0) {
            return 0.0;
        }

        $popularity = $candidate->getPopularity() ?? 0;

        return log(1 + max(0, $popularity)) / log(1 + $maxPopularity);
    }

    /**
     * Norme euclidienne d'un vecteur creux.
     *
     * @param array<int, float> $vector
     */
    private function norm(array $vector): float
    {
        $sum = 0.0;
        foreach ($vector as $value) {
            $sum += $value ** 2;
        }

        return sqrt($sum);
    }

    private function isStale(User $user): bool
    {
        /** @var array{count: int, latest: string|null}|null $row */
        $row = $this->entityManager->createQueryBuilder()
            ->select('COUNT(r.id) AS count', 'MAX(r.generatedAt) AS latest')
            ->from(Recommendation::class, 'r')
            ->where('r.user = :user')
            ->setParameter('user', $user)
            ->getQuery()
            ->getSingleResult();

        if (0 === (int) ($row['count'] ?? 0) || null === ($row['latest'] ?? null)) {
            return true;
        }

        $latest = new \DateTimeImmutable((string) $row['latest']);

        if ($latest->getTimestamp() < time() - self::FRESHNESS_SECONDS) {
            return true;
        }

        // Un favori ajouté après le dernier calcul rend celui-ci obsolète.
        $lastFavorite = $this->entityManager->createQueryBuilder()
            ->select('MAX(f.createdAt)')
            ->from(Favorite::class, 'f')
            ->where('f.user = :user')
            ->setParameter('user', $user)
            ->getQuery()
            ->getSingleScalarResult();

        // Comparaison large (`>=`) et non stricte : Postgres stocke ces horodatages à
        // la seconde. Un favori ajouté dans la même seconde que le dernier calcul
        // porte exactement la même valeur et passerait pour antérieur — les
        // recommandations resteraient muettes juste après l'action de l'utilisateur,
        // le moment précis où il attend un effet. Le coût est un recalcul superflu
        // pendant au plus une seconde, sur une opération idempotente.
        return null !== $lastFavorite && new \DateTimeImmutable((string) $lastFavorite) >= $latest;
    }

    private function clear(User $user): void
    {
        $this->entityManager->createQueryBuilder()
            ->delete(Recommendation::class, 'r')
            ->where('r.user = :user')
            ->setParameter('user', $user)
            ->getQuery()
            ->execute();
    }

    /**
     * Poids de chaque genre présent dans les favoris de l'utilisateur.
     *
     * Deux requêtes (une par type d'œuvre) plutôt qu'une jointure conditionnelle
     * acrobatique : le total est le même et la requête reste lisible.
     *
     * @return array<int, int> genreId => occurrences
     */
    private function tasteProfile(User $user): array
    {
        $profile = [];

        foreach (['anime', 'manga'] as $relation) {
            $rows = $this->entityManager->createQueryBuilder()
                ->select('g.id AS id', 'COUNT(g.id) AS weight')
                ->from(Favorite::class, 'f')
                ->join('f.'.$relation, 'media')
                ->join('media.genres', 'g')
                ->where('f.user = :user')
                ->groupBy('g.id')
                ->setParameter('user', $user)
                ->getQuery()
                ->getArrayResult();

            foreach ($rows as $row) {
                $id = (int) $row['id'];
                $profile[$id] = ($profile[$id] ?? 0) + (int) $row['weight'];
            }
        }

        return $profile;
    }

    /**
     * Identifiants à ne pas recommander : déjà en favori, ou déjà terminés.
     *
     * @return array{'App\Entity\Anime': list<int>, 'App\Entity\Manga': list<int>}
     */
    private function excludedIds(User $user): array
    {
        $excluded = [Anime::class => [], Manga::class => []];

        $favorites = $this->entityManager->createQueryBuilder()
            ->select('IDENTITY(f.anime) AS anime', 'IDENTITY(f.manga) AS manga')
            ->from(Favorite::class, 'f')
            ->where('f.user = :user')
            ->setParameter('user', $user)
            ->getQuery()
            ->getArrayResult();

        $finished = $this->entityManager->createQueryBuilder()
            ->select('IDENTITY(p.anime) AS anime', 'IDENTITY(p.manga) AS manga')
            ->from(Progress::class, 'p')
            ->where('p.user = :user')
            ->andWhere('p.status = :status')
            ->setParameter('user', $user)
            ->setParameter('status', ProgressStatus::COMPLETED->value)
            ->getQuery()
            ->getArrayResult();

        foreach ([...$favorites, ...$finished] as $row) {
            if (null !== $row['anime']) {
                $excluded[Anime::class][] = (int) $row['anime'];
            }
            if (null !== $row['manga']) {
                $excluded[Manga::class][] = (int) $row['manga'];
            }
        }

        $excluded[Anime::class] = array_values(array_unique($excluded[Anime::class]));
        $excluded[Manga::class] = array_values(array_unique($excluded[Manga::class]));

        return $excluded;
    }

    /**
     * Œuvres partageant au moins un genre avec le profil, hors exclusions.
     *
     * @param class-string<Anime|Manga> $class
     * @param list<int>                 $genreIds
     * @param list<int>                 $excludedIds
     *
     * @return list<Anime|Manga>
     */
    private function candidates(string $class, array $genreIds, array $excludedIds): array
    {
        // 1. les identifiants éligibles (au moins un genre en commun, hors exclusions)
        $qb = $this->entityManager->createQueryBuilder()
            ->select('DISTINCT c.id')
            ->from($class, 'c')
            ->join('c.genres', 'g')
            ->where('g.id IN (:genres)')
            ->setParameter('genres', $genreIds);

        if ([] !== $excludedIds) {
            $qb->andWhere('c.id NOT IN (:excluded)')->setParameter('excluded', $excludedIds);
        }

        $ids = array_column($qb->getQuery()->getArrayResult(), 'id');
        if ([] === $ids) {
            return [];
        }

        // 2. les entités, genres inclus, en une seule requête (pas de N+1)
        /** @var list<Anime|Manga> $result */
        $result = $this->entityManager->createQueryBuilder()
            ->select('c', 'genres')
            ->from($class, 'c')
            ->leftJoin('c.genres', 'genres')
            ->where('c.id IN (:ids)')
            ->setParameter('ids', $ids)
            ->getQuery()
            ->getResult();

        return $result;
    }
}
