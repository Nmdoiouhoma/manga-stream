<?php

declare(strict_types=1);

namespace App\Tests\Service\Anilist;

use App\Service\Anilist\AnilistClient;
use App\Service\Anilist\AnilistEpisode;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Fusion des deux sources d'épisodes d'AniList.
 *
 * Aucune I/O : les charges utiles reproduisent des réponses réellement observées sur
 * `graphql.anilist.co`, y compris leurs travers — c'est justement ce qu'on teste.
 */
#[CoversClass(AnilistClient::class)]
final class AnilistEpisodeParsingTest extends TestCase
{
    /**
     * @param array<string, mixed> $media
     *
     * @return array<int, list<AnilistEpisode>>
     */
    private static function parse(array $media): array
    {
        return AnilistClient::parseEpisodes(['data' => ['Page' => ['media' => [$media]]]]);
    }

    /**
     * @param list<AnilistEpisode> $episodes
     */
    private static function byNumber(array $episodes, int $number): ?AnilistEpisode
    {
        foreach ($episodes as $episode) {
            if ($episode->number === $number) {
                return $episode;
            }
        }

        return null;
    }

    public static function labelProvider(): \Generator
    {
        yield 'libellé canonique' => ['Episode 1 - Enter: Naruto Uzumaki!', 1, 'Enter: Naruto Uzumaki!'];
        yield 'tiret cadratin' => ['Episode 12 – Le titre', 12, 'Le titre'];
        yield 'deux-points' => ['Episode 7: Le titre', 7, 'Le titre'];
        yield 'abréviation' => ['Ep. 3 - Court', 3, 'Court'];
        yield 'sans titre' => ['Episode 5', 5, null];
        yield 'accentué' => ['Épisode 9 - Accentué', 9, 'Accentué'];
        yield 'numéro à trois chiffres' => ['Episode 130 - Scent of Danger!', 130, 'Scent of Danger!'];
        yield 'non numéroté' => ['Bande-annonce', null, null];
        yield 'chaîne vide' => ['', null, null];
        yield 'non-chaîne' => [null, null, null];
    }

    #[DataProvider('labelProvider')]
    public function testStreamingLabelParsing(mixed $label, ?int $expectedNumber, ?string $expectedTitle): void
    {
        self::assertSame([$expectedNumber, $expectedTitle], AnilistClient::parseStreamingLabel($label));
    }

    /**
     * Cas Death Note : `streamingEpisodes` complet, aucun `airingSchedule` (série de
     * 2006, antérieure à la mise en place des grilles de diffusion chez AniList).
     */
    public function testStreamingOnlySeriesGetsTitlesAndUrls(): void
    {
        $episodes = self::parse([
            'id' => 1535,
            'episodes' => 3,
            'duration' => 23,
            'streamingEpisodes' => [
                ['title' => 'Episode 1 - Rebirth', 'thumbnail' => 'https://cdn.example/1.jpg', 'url' => 'https://stream.example/1'],
                ['title' => 'Episode 2 - Confrontation', 'thumbnail' => 'https://cdn.example/2.jpg', 'url' => 'https://stream.example/2'],
                ['title' => 'Episode 3 - Dealings', 'thumbnail' => 'https://cdn.example/3.jpg', 'url' => 'https://stream.example/3'],
            ],
            'airingSchedule' => ['nodes' => []],
        ])[1535];

        self::assertCount(3, $episodes);
        self::assertSame([1, 2, 3], array_map(static fn (AnilistEpisode $e): int => $e->number, $episodes));

        $first = $episodes[0];
        self::assertSame('Rebirth', $first->title);
        self::assertSame('https://cdn.example/1.jpg', $first->thumbnail);
        self::assertSame('https://stream.example/1', $first->streamUrl);
        self::assertSame(23, $first->duration, 'La durée du média est reportée sur chaque épisode.');
        self::assertSame(AnilistEpisode::SOURCE_STREAMING, $first->source);
        self::assertNull($first->airDate, 'Sans airingSchedule, aucune date ne doit être inventée.');
    }

    /**
     * **Le piège central de `streamingEpisodes`.**
     *
     * L'entrée « Boku no Hero Academia » (id 21459) déclare 13 épisodes — c'est la
     * saison 1 — mais Crunchyroll y accroche les libellés de toute la franchise,
     * jusqu'à « Episode 159 ». Sans borne, la fiche de la saison 1 se retrouverait
     * avec des épisodes 157 à 159 portant des titres qui ne la concernent pas.
     */
    public function testEpisodesBeyondTheDeclaredCountAreRejected(): void
    {
        $episodes = self::parse([
            'id' => 21459,
            'episodes' => 13,
            'duration' => 24,
            'streamingEpisodes' => [
                ['title' => 'Episode 159 - Battle Without a Quirk', 'thumbnail' => null, 'url' => 'https://stream.example/159'],
                ['title' => 'Episode 158 - A Girl\'s Ego', 'thumbnail' => null, 'url' => 'https://stream.example/158'],
                ['title' => 'Episode 1 - Izuku Midoriya: Origin', 'thumbnail' => null, 'url' => 'https://stream.example/1'],
            ],
            'airingSchedule' => ['nodes' => [
                ['episode' => 1, 'airingAt' => 1459670400],
                ['episode' => 200, 'airingAt' => 1600000000],
            ]],
        ])[21459];

        $numbers = array_map(static fn (AnilistEpisode $e): int => $e->number, $episodes);

        self::assertSame(range(1, 13), $numbers, 'Seuls les 13 épisodes annoncés doivent exister.');
        self::assertNotContains(159, $numbers);
        self::assertNotContains(200, $numbers, 'Un airingSchedule hors bornes est écarté au même titre.');
        self::assertSame('Izuku Midoriya: Origin', self::byNumber($episodes, 1)?->title);
    }

    /**
     * Cas Kimetsu no Yaiba : les deux sources sont présentes et doivent se compléter,
     * l'une apportant le titre, l'autre la date.
     */
    public function testBothSourcesAreMerged(): void
    {
        $episodes = self::parse([
            'id' => 101922,
            'episodes' => 2,
            'duration' => 24,
            'streamingEpisodes' => [
                ['title' => 'Episode 1 - Cruelty', 'thumbnail' => 'https://cdn.example/1.jpg', 'url' => 'https://stream.example/1'],
            ],
            'airingSchedule' => ['nodes' => [
                ['episode' => 1, 'airingAt' => 1554561000],
                ['episode' => 2, 'airingAt' => 1555165800],
            ]],
        ])[101922];

        $first = self::byNumber($episodes, 1);
        self::assertNotNull($first);
        self::assertSame('Cruelty', $first->title, 'Le titre vient de streamingEpisodes.');
        self::assertSame('2019-04-06', $first->airDate?->format('Y-m-d'), 'La date vient d\'airingSchedule.');

        $second = self::byNumber($episodes, 2);
        self::assertNotNull($second);
        self::assertNull($second->title, 'airingSchedule ne fournit aucun titre : il ne faut pas en inventer.');
        self::assertSame('2019-04-13', $second->airDate?->format('Y-m-d'));
    }

    /**
     * Les numéros manquants sont comblés — c'est ce qui rend une fiche navigable même
     * quand AniList n'expose qu'une poignée d'épisodes sur 220.
     */
    public function testMissingNumbersAreFilledWithoutFabricatingContent(): void
    {
        $episodes = self::parse([
            'id' => 20,
            'episodes' => 10,
            'duration' => 23,
            'streamingEpisodes' => [
                ['title' => 'Episode 1 - Enter: Naruto Uzumaki!', 'thumbnail' => null, 'url' => null],
            ],
            'airingSchedule' => ['nodes' => []],
        ])[20];

        self::assertCount(10, $episodes);

        $derived = self::byNumber($episodes, 7);
        self::assertNotNull($derived);
        self::assertSame(AnilistEpisode::SOURCE_DERIVED, $derived->source);
        self::assertNull($derived->title);
        self::assertNull($derived->thumbnail);
        self::assertNull($derived->streamUrl);
        self::assertNull($derived->airDate);
        self::assertSame(23, $derived->duration, 'La durée moyenne du média reste une donnée réelle.');
    }

    /**
     * Série en cours (One Piece) : `episodes` vaut `null`. Aucun plafond n'est
     * vérifiable, la borne de complétion devient le plus grand numéro réellement vu.
     */
    public function testOngoingSeriesFallsBackToTheHighestObservedNumber(): void
    {
        $episodes = self::parse([
            'id' => 21,
            'episodes' => null,
            'duration' => 24,
            'streamingEpisodes' => [
                ['title' => 'Episode 130 - Scent of Danger!', 'thumbnail' => null, 'url' => 'https://stream.example/130'],
            ],
            'airingSchedule' => ['nodes' => [['episode' => 132, 'airingAt' => 1743854400]]],
        ])[21];

        self::assertCount(132, $episodes);
        self::assertSame('Scent of Danger!', self::byNumber($episodes, 130)?->title);
        self::assertSame(AnilistEpisode::SOURCE_DERIVED, self::byNumber($episodes, 5)?->source);
    }

    public function testAberrantCountsAreCapped(): void
    {
        $episodes = self::parse([
            'id' => 999,
            'episodes' => 500_000,
            'streamingEpisodes' => [],
            'airingSchedule' => ['nodes' => []],
        ])[999];

        self::assertCount(AnilistClient::MAX_EPISODES_PER_MEDIA, $episodes);
    }

    public function testMediaWithoutAnyEpisodeDataIsAbsentFromTheResult(): void
    {
        $result = self::parse([
            'id' => 404,
            'episodes' => null,
            'streamingEpisodes' => [],
            'airingSchedule' => ['nodes' => []],
        ]);

        self::assertSame([], $result, 'Un média sans la moindre donnée ne doit pas produire d\'entrée vide.');
    }

    public function testMalformedUrlsAreDiscarded(): void
    {
        $episodes = self::parse([
            'id' => 7,
            'episodes' => 1,
            'streamingEpisodes' => [
                ['title' => 'Episode 1 - Titre', 'thumbnail' => 'pas une url', 'url' => ''],
            ],
            'airingSchedule' => ['nodes' => []],
        ])[7];

        self::assertSame('Titre', $episodes[0]->title);
        self::assertNull($episodes[0]->thumbnail);
        self::assertNull($episodes[0]->streamUrl);
    }
}
