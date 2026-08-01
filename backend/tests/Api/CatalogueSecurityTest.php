<?php

declare(strict_types=1);

namespace App\Tests\Api;

use PHPUnit\Framework\Attributes\DataProvider;

/**
 * Le catalogue se lit sans compte, mais ne s'écrit qu'en administrateur.
 *
 * C'est la règle métier la plus visible du projet : un visiteur doit pouvoir parcourir
 * animes et mangas sans s'inscrire, et personne ne doit pouvoir modifier le catalogue
 * sans en avoir le droit.
 */
final class CatalogueSecurityTest extends ApiTestCase
{
    #[DataProvider('publicCollections')]
    public function testCatalogueCollectionsAreReadableWithoutToken(string $url): void
    {
        $this->client()->request('GET', $url);

        self::assertResponseIsSuccessful();
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function publicCollections(): iterable
    {
        yield 'animes' => ['/api/animes'];
        yield 'mangas' => ['/api/mangas'];
        yield 'episodes' => ['/api/episodes'];
        yield 'chapters' => ['/api/chapters'];
        yield 'genres' => ['/api/genres'];
        yield 'comments' => ['/api/comments'];
    }

    public function testAnAnimeItemIsReadableWithoutToken(): void
    {
        $anime = $this->createAnime('Cowboy Bebop', 'Cowboy Bebop');

        $this->client()->request('GET', '/api/animes/'.$anime->getId());

        self::assertResponseIsSuccessful();
        self::assertJsonContains(['titleRomaji' => 'Cowboy Bebop']);
    }

    #[DataProvider('catalogueWriteEndpoints')]
    public function testWritingTheCatalogueWithoutTokenIsRejected(string $url, array $payload): void
    {
        $this->client()->request('POST', $url, [
            'headers' => ['Content-Type' => 'application/ld+json'],
            'json' => $payload,
        ]);

        self::assertResponseStatusCodeSame(401);
    }

    #[DataProvider('catalogueWriteEndpoints')]
    public function testWritingTheCatalogueAsASimpleUserIsForbidden(string $url, array $payload): void
    {
        $token = $this->tokenFor($this->createUser('user@example.com', 'user'));

        $this->client($token)->request('POST', $url, [
            'headers' => ['Content-Type' => 'application/ld+json'],
            'json' => $payload,
        ]);

        self::assertResponseStatusCodeSame(403);
    }

    /**
     * @return iterable<string, array{string, array<string, mixed>}>
     */
    public static function catalogueWriteEndpoints(): iterable
    {
        yield 'anime' => ['/api/animes', ['titleRomaji' => 'Intrus']];
        yield 'manga' => ['/api/mangas', ['titleRomaji' => 'Intrus']];
        yield 'genre' => ['/api/genres', ['name' => 'Intrus', 'slug' => 'intrus']];
    }

    public function testAnAdministratorCanCreateAnAnime(): void
    {
        $token = $this->tokenFor($this->createUser('admin@example.com', 'admin', admin: true));

        $this->client($token)->request('POST', '/api/animes', [
            'headers' => ['Content-Type' => 'application/ld+json'],
            'json' => ['titleRomaji' => 'Ashita no Joe', 'titleEnglish' => 'Tomorrow\'s Joe'],
        ]);

        self::assertResponseStatusCodeSame(201);
        self::assertJsonContains(['titleRomaji' => 'Ashita no Joe']);
    }

    public function testDeletingAnAnimeAsASimpleUserIsForbidden(): void
    {
        $anime = $this->createAnime('Serial Experiments Lain');
        $token = $this->tokenFor($this->createUser('user@example.com', 'user'));

        $this->client($token)->request('DELETE', '/api/animes/'.$anime->getId());

        self::assertResponseStatusCodeSame(403);
    }
}
