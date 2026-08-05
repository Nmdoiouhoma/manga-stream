<?php

declare(strict_types=1);

namespace App\Service\Anilist;

/**
 * Découpage de l'année en cours de diffusion.
 *
 * Janvier, avril, juillet, octobre. Ce n'est pas la définition littérale
 * d'AniList (qui fait commencer l'hiver en décembre) mais ce que ses données
 * contiennent, relevé sur le catalogue importé : le mois de démarrage dominant
 * est janvier pour `WINTER` (214 titres contre 6 en décembre), avril pour
 * `SPRING`, juillet pour `SUMMER`, octobre pour `FALL`.
 *
 * Jumeau de `frontend/src/lib/season.ts`. Les deux se contentent de répondre à
 * « quelle saison sommes-nous » ; la saison d'une œuvre n'est jamais recalculée
 * ici, elle est lue telle qu'AniList l'a fournie.
 */
final class AnilistSeason
{
    /** Dans l'ordre de diffusion. */
    public const ALL = AnilistClient::SEASONS;

    /** La saison d'un mois civil (1 = janvier). */
    public static function ofMonth(int $month): string
    {
        $index = intdiv(min(12, max(1, $month)) - 1, 3);

        return self::ALL[$index];
    }

    /**
     * La saison en cours.
     *
     * La date est un paramètre : un service qui lit l'horloge lui-même n'est
     * testable qu'en gelant le temps.
     *
     * @return array{season: string, year: int}
     */
    public static function current(\DateTimeImmutable $now): array
    {
        return [
            'season' => self::ofMonth((int) $now->format('n')),
            'year' => (int) $now->format('Y'),
        ];
    }

    public static function isValid(?string $season): bool
    {
        return \in_array($season, self::ALL, true);
    }
}
