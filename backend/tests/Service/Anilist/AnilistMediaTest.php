<?php

declare(strict_types=1);

namespace App\Tests\Service\Anilist;

use App\Enum\AnimeSeason;
use App\Enum\MediaStatus;
use App\Service\Anilist\AnilistMedia;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Parsing d'une réponse AniList figée — aucun appel réseau.
 *
 * C'est l'intérêt d'avoir isolé le parsing dans un DTO : la forme exacte des données
 * distantes est vérifiée ici, sans dépendre de la disponibilité ni du contenu courant
 * de l'API publique.
 */
#[CoversClass(AnilistMedia::class)]
final class AnilistMediaTest extends TestCase
{
    /**
     * Nœud réellement renvoyé par graphql.anilist.co pour Shingeki no Kyojin (#16498),
     * réduit aux champs demandés par la requête du client.
     *
     * @return array<string, mixed>
     */
    private static function node(): array
    {
        return [
            'id' => 16498,
            'type' => 'ANIME',
            'title' => [
                'romaji' => 'Shingeki no Kyojin',
                'english' => 'Attack on Titan',
                'native' => '進撃の巨人',
            ],
            'description' => 'Several hundred years ago, humans were nearly exterminated by Titans.<br>\n<br>\nSource: <i>Manga</i>',
            'coverImage' => [
                'extraLarge' => 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx16498.jpg',
                'large' => 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx16498.jpg',
                'medium' => 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/small/bx16498.jpg',
            ],
            'bannerImage' => 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/16498.jpg',
            'episodes' => 25,
            'chapters' => null,
            'volumes' => null,
            'averageScore' => 84,
            'status' => 'FINISHED',
            'season' => 'SPRING',
            'seasonYear' => 2013,
            'startDate' => ['year' => 2013, 'month' => 4, 'day' => 7],
            'endDate' => ['year' => 2013, 'month' => 9, 'day' => 29],
            'genres' => ['Action', 'Drama', 'Fantasy', 'Mystery'],
        ];
    }

    public function testParsesEveryFieldOfARealNode(): void
    {
        $media = AnilistMedia::fromApiNode(self::node());

        self::assertSame(16498, $media->anilistId);
        self::assertSame(AnilistMedia::TYPE_ANIME, $media->type);
        self::assertTrue($media->isAnime());
        self::assertSame('Shingeki no Kyojin', $media->titleRomaji);
        self::assertSame('Attack on Titan', $media->titleEnglish);
        self::assertSame('進撃の巨人', $media->titleNative);
        self::assertSame(25, $media->episodes);
        self::assertNull($media->chapters);
        self::assertNull($media->volumes);
        self::assertSame(84, $media->averageScore);
        self::assertSame(MediaStatus::FINISHED, $media->status);
        self::assertSame(AnimeSeason::SPRING, $media->season);
        self::assertSame(2013, $media->seasonYear);
        self::assertSame('2013-04-07', $media->startDate?->format('Y-m-d'));
        self::assertSame('2013-09-29', $media->endDate?->format('Y-m-d'));
        self::assertSame(['Action', 'Drama', 'Fantasy', 'Mystery'], $media->genres);
        self::assertSame(
            'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx16498.jpg',
            $media->coverImage,
            'La plus grande jaquette disponible doit être préférée.',
        );
    }

    public function testStripsTheHtmlOfTheSynopsis(): void
    {
        $media = AnilistMedia::fromApiNode(self::node());

        self::assertNotNull($media->synopsis);
        self::assertStringNotContainsString('<br>', $media->synopsis);
        self::assertStringNotContainsString('<i>', $media->synopsis);
        self::assertStringStartsWith('Several hundred years ago', $media->synopsis);
    }

    /**
     * AniList renvoie `null` sur presque tous les champs : le parsing ne doit jamais
     * s'effondrer pour autant, tant qu'il reste un identifiant et un titre.
     */
    public function testToleratesAnAlmostEmptyNode(): void
    {
        $media = AnilistMedia::fromApiNode([
            'id' => 1,
            'type' => 'MANGA',
            'title' => ['romaji' => null, 'english' => null, 'native' => 'ワンピース'],
        ]);

        self::assertSame('ワンピース', $media->titleRomaji, 'Le titre natif comble un romaji absent.');
        self::assertFalse($media->isAnime());
        self::assertNull($media->synopsis);
        self::assertNull($media->coverImage);
        self::assertNull($media->status);
        self::assertNull($media->startDate);
        self::assertSame([], $media->genres);
    }

    /**
     * Les « fuzzy dates » d'AniList ont des composantes facultatives.
     */
    #[DataProvider('fuzzyDates')]
    public function testHandlesFuzzyDates(mixed $raw, ?string $expected): void
    {
        $media = AnilistMedia::fromApiNode([
            'id' => 1,
            'title' => ['romaji' => 'Test'],
            'startDate' => $raw,
        ]);

        self::assertSame($expected, $media->startDate?->format('Y-m-d'));
    }

    /**
     * @return iterable<string, array{mixed, ?string}>
     */
    public static function fuzzyDates(): iterable
    {
        yield 'date complète' => [['year' => 2013, 'month' => 4, 'day' => 7], '2013-04-07'];
        yield 'année seule' => [['year' => 1999, 'month' => null, 'day' => null], '1999-01-01'];
        yield 'sans année' => [['year' => null, 'month' => 4, 'day' => 7], null];
        yield 'tout à null' => [['year' => null, 'month' => null, 'day' => null], null];
        yield 'absente' => [null, null];
    }

    public function testRejectsANodeWithoutIdentifier(): void
    {
        $this->expectException(\InvalidArgumentException::class);

        AnilistMedia::fromApiNode(['title' => ['romaji' => 'Sans identifiant']]);
    }

    public function testRejectsANodeWithoutAnyTitle(): void
    {
        $this->expectException(\InvalidArgumentException::class);

        AnilistMedia::fromApiNode(['id' => 42, 'title' => ['romaji' => null, 'english' => null, 'native' => null]]);
    }

    public function testIgnoresOutOfRangeValues(): void
    {
        $media = AnilistMedia::fromApiNode([
            'id' => 1,
            'title' => ['romaji' => 'Test'],
            'averageScore' => 250,
            'seasonYear' => 12,
            'episodes' => 0,
            'status' => 'INVENTED_STATUS',
        ]);

        self::assertNull($media->averageScore);
        self::assertNull($media->seasonYear);
        self::assertNull($media->episodes);
        self::assertNull($media->status);
    }
}
