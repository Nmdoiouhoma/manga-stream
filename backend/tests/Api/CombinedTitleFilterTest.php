<?php

declare(strict_types=1);

namespace App\Tests\Api;

use App\Filter\CombinedTitleFilter;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\DataProvider;

/**
 * Filtre `?title=` : un OU sur les trois colonnes de titre.
 *
 * Les `SearchFilter` natifs sont combinés en ET : chercher « Attack on Titan »
 * ne remontait rien tant que le titre romaji stocké était « Shingeki no Kyojin ».
 * C'est exactement ce que ces tests verrouillent.
 */
#[CoversClass(CombinedTitleFilter::class)]
final class CombinedTitleFilterTest extends ApiTestCase
{
    private function fixtures(): void
    {
        $this->createAnime('Shingeki no Kyojin', 'Attack on Titan', '進撃の巨人');
        $this->createAnime('Cowboy Bebop', 'Cowboy Bebop', 'カウボーイビバップ');
        $this->createAnime('Sousou no Frieren', 'Frieren: Beyond Journey\'s End', '葬送のフリーレン');
    }

    /**
     * @return list<string>
     */
    private function search(string $resource, string $title): array
    {
        $this->client()->request('GET', $resource.'?title='.rawurlencode($title), [
            'headers' => ['Accept' => 'application/json'],
        ]);
        self::assertResponseIsSuccessful();

        /** @var list<array{titleRomaji: string}> $items */
        $items = json_decode((string) self::getClient()->getResponse()->getContent(), true);

        return array_map(static fn (array $item): string => $item['titleRomaji'], $items);
    }

    /**
     * Le cas d'usage d'origine : chaque colonne, à elle seule, doit suffire.
     */
    #[DataProvider('queriesMatchingAttackOnTitan')]
    public function testEachTitleColumnCanMatchOnItsOwn(string $query): void
    {
        $this->fixtures();

        self::assertSame(['Shingeki no Kyojin'], $this->search('/api/animes', $query));
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function queriesMatchingAttackOnTitan(): iterable
    {
        yield 'colonne anglaise' => ['Attack on Titan'];
        yield 'colonne romaji' => ['Shingeki'];
        yield 'colonne native' => ['進撃'];
        yield 'insensible à la casse' => ['aTTaCk On TiTaN'];
        yield 'correspondance partielle' => ['on tita'];
    }

    public function testAnUnmatchedTermReturnsNothing(): void
    {
        $this->fixtures();

        self::assertSame([], $this->search('/api/animes', 'zzzz-inexistant'));
    }

    public function testTheFilterCanMatchSeveralWorks(): void
    {
        $this->fixtures();
        $this->createAnime('Shingeki no Kyojin Season 2', 'Attack on Titan Season 2');

        $results = $this->search('/api/animes', 'attack on titan');

        self::assertCount(2, $results);
        self::assertContains('Shingeki no Kyojin', $results);
        self::assertContains('Shingeki no Kyojin Season 2', $results);
    }

    public function testTheFilterAlsoAppliesToMangas(): void
    {
        $this->createManga('Berserk', 'Berserk', 'ベルセルク');
        $this->createManga('Kimetsu no Yaiba', 'Demon Slayer', '鬼滅の刃');

        self::assertSame(['Kimetsu no Yaiba'], $this->search('/api/mangas', 'demon slayer'));
        self::assertSame(['Kimetsu no Yaiba'], $this->search('/api/mangas', '鬼滅'));
    }

    /**
     * Les jokers SQL saisis par l'utilisateur doivent être neutralisés, sans quoi
     * `?title=%` ramènerait tout le catalogue.
     */
    public function testSqlWildcardsAreEscaped(): void
    {
        $this->fixtures();

        self::assertSame([], $this->search('/api/animes', '%'));
        self::assertSame([], $this->search('/api/animes', '_'));
    }

    public function testAnEmptyTitleDoesNotFilter(): void
    {
        $this->fixtures();

        self::assertCount(3, $this->search('/api/animes', ''));
    }

    /**
     * Le filtre est additif : les `SearchFilter` d'origine restent utilisables.
     */
    public function testExistingFiltersStillWork(): void
    {
        $this->fixtures();

        $this->client()->request('GET', '/api/animes?titleRomaji=Cowboy', [
            'headers' => ['Accept' => 'application/json'],
        ]);
        self::assertResponseIsSuccessful();

        $items = json_decode((string) self::getClient()->getResponse()->getContent(), true);
        self::assertCount(1, $items);
        self::assertSame('Cowboy Bebop', $items[0]['titleRomaji']);
    }

    public function testTheFilterIsDocumentedInTheContract(): void
    {
        $this->client()->request('GET', '/api/docs', ['headers' => ['Accept' => 'application/vnd.openapi+json']]);
        self::assertResponseIsSuccessful();

        $contract = json_decode((string) self::getClient()->getResponse()->getContent(), true);
        $parameters = array_column($contract['paths']['/api/animes']['get']['parameters'], 'name');

        self::assertContains('title', $parameters);
    }
}
