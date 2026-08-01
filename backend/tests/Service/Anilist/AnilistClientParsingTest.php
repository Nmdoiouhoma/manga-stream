<?php

declare(strict_types=1);

namespace App\Tests\Service\Anilist;

use App\Service\Anilist\AnilistClient;
use App\Service\Anilist\AnilistException;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\TestCase;

/**
 * Lecture d'une enveloppe de réponse AniList complète, sans réseau.
 *
 * `AnilistClient::parsePage()` est volontairement statique et pure, précisément pour
 * pouvoir vérifier ici le comportement sur des réponses dégradées (média illisible,
 * erreurs GraphQL) qu'il serait impossible de provoquer à la demande sur l'API réelle.
 */
#[CoversClass(AnilistClient::class)]
final class AnilistClientParsingTest extends TestCase
{
    public function testParsesAPageAndItsPagination(): void
    {
        $page = AnilistClient::parsePage([
            'data' => [
                'Page' => [
                    'pageInfo' => ['currentPage' => 2, 'hasNextPage' => true, 'total' => 5000],
                    'media' => [
                        ['id' => 16498, 'type' => 'ANIME', 'title' => ['romaji' => 'Shingeki no Kyojin']],
                        ['id' => 21, 'type' => 'ANIME', 'title' => ['romaji' => 'ONE PIECE']],
                    ],
                ],
            ],
        ]);

        self::assertCount(2, $page->media);
        self::assertSame(2, $page->currentPage);
        self::assertTrue($page->hasNextPage);
        self::assertSame(5000, $page->total);
        self::assertSame('Shingeki no Kyojin', $page->media[0]->titleRomaji);
    }

    /**
     * Un média inexploitable ne doit pas emporter la page entière : perdre 1 titre sur
     * 50 vaut mieux que perdre les 50.
     */
    public function testSkipsUnusableMediaWithoutFailingThePage(): void
    {
        $page = AnilistClient::parsePage([
            'data' => [
                'Page' => [
                    'pageInfo' => ['currentPage' => 1, 'hasNextPage' => false],
                    'media' => [
                        ['id' => 1, 'title' => ['romaji' => 'Valide']],
                        ['title' => ['romaji' => 'Sans identifiant']],
                        ['id' => 3, 'title' => ['romaji' => null, 'english' => null, 'native' => null]],
                        'ceci n\'est pas un objet',
                        ['id' => 5, 'title' => ['romaji' => 'Valide aussi']],
                    ],
                ],
            ],
        ]);

        self::assertCount(2, $page->media);
        self::assertSame([1, 5], array_map(static fn ($m) => $m->anilistId, $page->media));
    }

    public function testEmptyPageIsNotAnError(): void
    {
        $page = AnilistClient::parsePage([
            'data' => ['Page' => ['pageInfo' => ['currentPage' => 99, 'hasNextPage' => false], 'media' => []]],
        ]);

        self::assertSame([], $page->media);
        self::assertFalse($page->hasNextPage);
    }

    public function testRejectsAResponseWithoutPageNode(): void
    {
        $this->expectException(AnilistException::class);

        AnilistClient::parsePage(['errors' => [['message' => 'Too Many Requests']]]);
    }
}
