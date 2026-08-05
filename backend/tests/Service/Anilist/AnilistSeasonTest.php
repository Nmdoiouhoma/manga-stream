<?php

declare(strict_types=1);

namespace App\Tests\Service\Anilist;

use App\Service\Anilist\AnilistSeason;
use PHPUnit\Framework\TestCase;

/**
 * Découpage en cours de diffusion. Arithmétique pure, aucun noyau à démarrer.
 *
 * Jumeau de `frontend/src/lib/season.test.ts` : les deux implémentations doivent
 * répondre la même chose, sans quoi le planning demanderait au backend une saison
 * et en afficherait une autre.
 */
final class AnilistSeasonTest extends TestCase
{
    public function testTheYearIsCutInFourCours(): void
    {
        foreach ([1, 2, 3] as $month) {
            self::assertSame('WINTER', AnilistSeason::ofMonth($month));
        }
        foreach ([4, 5, 6] as $month) {
            self::assertSame('SPRING', AnilistSeason::ofMonth($month));
        }
        foreach ([7, 8, 9] as $month) {
            self::assertSame('SUMMER', AnilistSeason::ofMonth($month));
        }
        foreach ([10, 11, 12] as $month) {
            self::assertSame('FALL', AnilistSeason::ofMonth($month));
        }
    }

    /**
     * Un mois hors bornes est ramené dans l'intervalle plutôt que de produire un index
     * de tableau inexistant : la synchronisation ne doit pas tomber sur une date bancale.
     */
    public function testOutOfRangeMonthsAreClamped(): void
    {
        self::assertSame('WINTER', AnilistSeason::ofMonth(0));
        self::assertSame('WINTER', AnilistSeason::ofMonth(-5));
        self::assertSame('FALL', AnilistSeason::ofMonth(13));
    }

    public function testTheCurrentSeasonIsReadFromTheGivenDate(): void
    {
        self::assertSame(
            ['season' => 'SUMMER', 'year' => 2026],
            AnilistSeason::current(new \DateTimeImmutable('2026-08-05 12:00:00')),
        );
        self::assertSame(
            ['season' => 'WINTER', 'year' => 2026],
            AnilistSeason::current(new \DateTimeImmutable('2026-01-01 00:00:00')),
        );
        self::assertSame(
            ['season' => 'FALL', 'year' => 2025],
            AnilistSeason::current(new \DateTimeImmutable('2025-12-31 23:59:59')),
        );
    }

    public function testOnlyAnilistEnumValuesAreAccepted(): void
    {
        self::assertTrue(AnilistSeason::isValid('WINTER'));
        self::assertTrue(AnilistSeason::isValid('FALL'));
        self::assertFalse(AnilistSeason::isValid('AUTOMNE'));
        self::assertFalse(AnilistSeason::isValid('fall'));
        self::assertFalse(AnilistSeason::isValid(null));
    }
}
