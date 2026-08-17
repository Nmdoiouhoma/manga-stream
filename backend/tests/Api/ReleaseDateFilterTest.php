<?php

declare(strict_types=1);

namespace App\Tests\Api;

use App\Entity\Chapter;
use App\Entity\Episode;

/**
 * Filtre `?airDate[after]=` / `?releaseDate[after]=` sur les collections
 * `/api/episodes` et `/api/chapters`.
 *
 * Pensé pour une automatisation externe (n8n…) qui interroge périodiquement
 * « qu'est-ce qui est sorti depuis mon dernier passage », sans avoir à repaginer
 * une collection triée ni à dédupliquer par identifiant côté client.
 */
final class ReleaseDateFilterTest extends ApiTestCase
{
    private function createEpisode(int $number, string $airDate): Episode
    {
        $anime = $this->createAnime('Sousou no Frieren');

        $episode = (new Episode())
            ->setAnime($anime)
            ->setNumber($number)
            ->setAirDate(new \DateTimeImmutable($airDate));

        $this->em()->persist($episode);
        $this->em()->flush();

        return $episode;
    }

    private function createChapter(int $number, string $releaseDate): Chapter
    {
        $manga = $this->createManga('Berserk');

        $chapter = (new Chapter())
            ->setManga($manga)
            ->setNumber((string) $number)
            ->setReleaseDate(new \DateTimeImmutable($releaseDate));

        $this->em()->persist($chapter);
        $this->em()->flush();

        return $chapter;
    }

    public function testEpisodesCanBeFilteredByAirDateAfter(): void
    {
        $this->createEpisode(1, '2026-08-01');
        $this->createEpisode(2, '2026-08-10');
        $this->createEpisode(3, '2026-08-16');

        $this->client()->request('GET', '/api/episodes?airDate[after]=2026-08-09&order[airDate]=asc', [
            'headers' => ['Accept' => 'application/json'],
        ]);
        self::assertResponseIsSuccessful();

        /** @var list<array{number: int}> $items */
        $items = json_decode((string) self::getClient()->getResponse()->getContent(), true);

        self::assertSame([2, 3], array_column($items, 'number'));
    }

    public function testChaptersCanBeFilteredByReleaseDateAfter(): void
    {
        $this->createChapter(1, '2026-08-01');
        $this->createChapter(2, '2026-08-10');
        $this->createChapter(3, '2026-08-16');

        $this->client()->request('GET', '/api/chapters?releaseDate[after]=2026-08-09&order[releaseDate]=asc', [
            'headers' => ['Accept' => 'application/json'],
        ]);
        self::assertResponseIsSuccessful();

        /** @var list<array{number: string}> $items */
        $items = json_decode((string) self::getClient()->getResponse()->getContent(), true);

        self::assertSame(['2.00', '3.00'], array_column($items, 'number'));
    }

    public function testTheFiltersAreDocumentedInTheContract(): void
    {
        $this->client()->request('GET', '/api/docs', ['headers' => ['Accept' => 'application/vnd.openapi+json']]);
        self::assertResponseIsSuccessful();

        $contract = json_decode((string) self::getClient()->getResponse()->getContent(), true);

        $episodeParameters = array_column($contract['paths']['/api/episodes']['get']['parameters'], 'name');
        self::assertContains('airDate[after]', $episodeParameters);

        $chapterParameters = array_column($contract['paths']['/api/chapters']['get']['parameters'], 'name');
        self::assertContains('releaseDate[after]', $chapterParameters);
    }
}
