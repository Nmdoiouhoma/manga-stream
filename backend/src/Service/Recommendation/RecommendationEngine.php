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
 * Moteur de recommandation v1 — recouvrement de genres.
 *
 * Principe, volontairement simple et explicable :
 *
 *  1. les favoris de l'utilisateur forment un « profil de goût » : chaque genre y est
 *     pondéré par son nombre d'occurrences (3 favoris Action => Action pèse 3) ;
 *  2. chaque œuvre du catalogue partageant au moins un genre avec ce profil reçoit
 *     pour score la somme des poids des genres communs, ramenée au poids total du
 *     profil — donc « quelle part des goûts de l'utilisateur cette œuvre couvre »,
 *     dans [0, 1] ;
 *  3. sont exclues les œuvres déjà en favori et celles marquées comme terminées.
 *
 * Chaque recommandation porte son explication (`reason`) : stratégie, genres ayant
 * déclenché le rapprochement, et poids brut. C'est une v1 : ni filtrage collaboratif,
 * ni pondération par popularité ou par récence.
 */
final readonly class RecommendationEngine
{
    /** Nombre de recommandations conservées par utilisateur. */
    public const LIMIT = 20;

    /** Durée au-delà de laquelle un jeu de recommandations est considéré périmé. */
    private const FRESHNESS_SECONDS = 3600;

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

        $scored = [];
        foreach ([Anime::class, Manga::class] as $class) {
            foreach ($this->candidates($class, $genreIds, $excluded[$class]) as $candidate) {
                $matched = [];
                $weight = 0;

                foreach ($candidate->getGenres() as $genre) {
                    $id = $genre->getId();
                    if (isset($profile[$id])) {
                        $weight += $profile[$id];
                        $matched[] = $genre->getSlug();
                    }
                }

                if (0 === $weight) {
                    continue;
                }

                $scored[] = [
                    'entity' => $candidate,
                    'score' => min(1.0, $weight / $totalWeight),
                    'weight' => $weight,
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
                    'strategy' => 'genre_overlap',
                    'genres' => $item['genres'],
                    'weight' => $item['weight'],
                    'profileWeight' => $totalWeight,
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
