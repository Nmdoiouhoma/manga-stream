<?php

declare(strict_types=1);

namespace App\Service\Catalogue;

use App\Entity\Chapter;
use App\Entity\Manga;
use Doctrine\ORM\EntityManagerInterface;

/**
 * Matérialise les chapitres d'un manga à partir du seul compte connu, `chapterCount`.
 *
 * ⚠️ Ce service **ne synchronise rien** : il dérive, et son nom le dit. AniList
 * n'expose aucune liste de chapitres — l'introspection du type `Media` de son schéma
 * GraphQL ne comporte que le scalaire `chapters` (un entier) et `volumes`. Il n'existe
 * ni connexion `chapters { ... }`, ni équivalent de `streamingEpisodes` côté manga.
 *
 * Les lignes produites ne portent donc **que leur numéro** : pas de titre, pas de date
 * de parution, pas d'URL de lecture. Inventer ces champs serait fabriquer des données ;
 * la numérotation, elle, se déduit honnêtement d'un compte que l'API fournit vraiment.
 * C'est ce qui rend la fiche manga navigable et la progression par chapitre utilisable.
 *
 * Idempotent : upsert sur `(manga, number)`, index unique déjà présent en base.
 */
final class ChapterDeriver
{
    /**
     * Garde-fou identique à celui des épisodes : un `chapters` aberrant ne doit pas
     * pouvoir remplir la table à lui seul.
     */
    public const MAX_CHAPTERS_PER_MANGA = 5000;

    public function __construct(private readonly EntityManagerInterface $entityManager)
    {
    }

    /**
     * @return array{created: int, skipped: int} `skipped` = chapitres déjà présents
     */
    public function derive(Manga $manga): array
    {
        $total = $manga->getChapterCount();

        if (null === $total || $total < 1) {
            // Manga en cours ou compte inconnu : AniList ne dit rien, on n'invente rien.
            return ['created' => 0, 'skipped' => 0];
        }

        $total = min($total, self::MAX_CHAPTERS_PER_MANGA);

        $existing = [];
        foreach ($this->entityManager->getRepository(Chapter::class)->findBy(['manga' => $manga]) as $chapter) {
            $existing[self::normalize($chapter->getNumber())] = true;
        }

        $created = 0;
        $skipped = 0;

        for ($number = 1; $number <= $total; ++$number) {
            $key = self::normalize((string) $number);

            if (isset($existing[$key])) {
                ++$skipped;
                continue;
            }

            $this->entityManager->persist(
                (new Chapter())->setManga($manga)->setNumber($key),
            );
            ++$created;
        }

        return ['created' => $created, 'skipped' => $skipped];
    }

    /**
     * La colonne est un `decimal(8,2)` : Postgres renvoie « 12.00 », un client peut
     * envoyer « 12 » ou « 12.0 ». On compare toujours sur une forme canonique, sans
     * quoi un second passage recréerait tous les chapitres.
     */
    private static function normalize(string $number): string
    {
        return number_format((float) $number, 2, '.', '');
    }
}
