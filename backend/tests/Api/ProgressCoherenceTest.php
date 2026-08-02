<?php

declare(strict_types=1);

namespace App\Tests\Api;

use App\Entity\Anime;
use App\Entity\Manga;
use App\Entity\Progress;
use App\Entity\User;
use App\Enum\ProgressStatus;

/**
 * Cohérence d'une progression avec l'œuvre suivie.
 *
 * Les trois premiers tests ancrent des requêtes qui répondaient 201 en production et
 * écrivaient des données absurdes en base. Le frontend se gardait du cas « chapitre
 * sur un anime » : la règle n'existait donc que côté client, et un curl suffisait à
 * la contourner.
 */
final class ProgressCoherenceTest extends ApiTestCase
{
    private const HEADERS = ['headers' => ['Content-Type' => 'application/ld+json']];

    private function animeWith(int $episodeCount): Anime
    {
        $anime = $this->createAnime('Série bornée');
        $anime->setEpisodeCount($episodeCount);
        $this->em()->flush();

        return $anime;
    }

    private function mangaWith(?int $chapterCount): Manga
    {
        $manga = $this->createManga('Série papier');
        $manga->setChapterCount($chapterCount);
        $this->em()->flush();

        return $manga;
    }

    /**
     * @param array<string, mixed> $payload
     */
    private function post(User $user, array $payload): \Symfony\Contracts\HttpClient\ResponseInterface
    {
        return $this->client($this->tokenFor($this->reattach($user)))
            ->request('POST', '/api/progress', self::HEADERS + ['json' => $payload]);
    }

    /**
     * Cas 3 des relevés : un numéro de chapitre sur un ANIME.
     */
    public function testAChapterOnAnAnimeIsRejected(): void
    {
        $user = $this->createUser('unite@example.com', 'unite');
        $anime = $this->animeWith(25);

        $this->post($user, [
            'anime' => '/api/animes/'.$anime->getId(),
            'status' => 'WATCHING',
            'currentChapter' => '42.5',
        ]);

        self::assertResponseStatusCodeSame(422);
        self::assertStringContainsString('currentChapter', (string) self::getClient()->getResponse()->getContent());
    }

    /**
     * Symétrique : un numéro d'épisode sur un MANGA.
     */
    public function testAnEpisodeOnAMangaIsRejected(): void
    {
        $user = $this->createUser('unite2@example.com', 'unite2');
        $manga = $this->mangaWith(100);

        $this->post($user, [
            'manga' => '/api/mangas/'.$manga->getId(),
            'status' => 'WATCHING',
            'currentEpisode' => 3,
        ]);

        self::assertResponseStatusCodeSame(422);
        self::assertStringContainsString('currentEpisode', (string) self::getClient()->getResponse()->getContent());
    }

    /**
     * Cas 2 des relevés : aucune borne haute sur `currentEpisode`.
     */
    public function testAnEpisodeAboveTheTotalIsRejected(): void
    {
        $user = $this->createUser('borne@example.com', 'borne');
        $anime = $this->animeWith(25);

        $this->post($user, [
            'anime' => '/api/animes/'.$anime->getId(),
            'status' => 'WATCHING',
            'currentEpisode' => 9999,
        ]);

        self::assertResponseStatusCodeSame(422);
    }

    public function testAChapterAboveTheTotalIsRejected(): void
    {
        $user = $this->createUser('borne2@example.com', 'borne2');
        $manga = $this->mangaWith(100);

        $this->post($user, [
            'manga' => '/api/mangas/'.$manga->getId(),
            'status' => 'WATCHING',
            'currentChapter' => '100.5',
        ]);

        self::assertResponseStatusCodeSame(422);
    }

    /**
     * Le dernier épisode reste évidemment atteignable : la borne est inclusive.
     */
    public function testTheLastEpisodeIsAccepted(): void
    {
        $user = $this->createUser('dernier@example.com', 'dernier');
        $anime = $this->animeWith(25);

        $response = $this->post($user, [
            'anime' => '/api/animes/'.$anime->getId(),
            'status' => 'WATCHING',
            'currentEpisode' => 25,
        ]);

        self::assertResponseStatusCodeSame(201);
        self::assertSame(25, $response->toArray()['currentEpisode']);
    }

    /**
     * Total inconnu (série en cours) : aucune borne haute ne doit être inventée.
     */
    public function testAnUnknownTotalDoesNotBoundAnything(): void
    {
        $user = $this->createUser('encours@example.com', 'encours');
        // createAnime() laisse episodeCount à null : exactement le cas d'une série
        // encore en diffusion.
        $anime = $this->createAnime('Série en cours');

        $this->post($user, [
            'anime' => '/api/animes/'.$anime->getId(),
            'status' => 'WATCHING',
            'currentEpisode' => 812,
        ]);

        self::assertResponseStatusCodeSame(201);
    }

    /**
     * Cas 1 des relevés : « Terminé, épisode 1 » sur une série de 25 épisodes.
     *
     * Décision retenue : normalisation, pas rejet. La requête aboutit, mais le
     * compteur enregistré vaut le total — et la réponse le dit.
     */
    public function testCompletedNormalisesTheEpisodeToTheTotal(): void
    {
        $user = $this->createUser('termine@example.com', 'termine');
        $anime = $this->animeWith(25);

        $response = $this->post($user, [
            'anime' => '/api/animes/'.$anime->getId(),
            'status' => 'COMPLETED',
            'currentEpisode' => 1,
        ]);

        self::assertResponseStatusCodeSame(201);
        self::assertSame(25, $response->toArray()['currentEpisode'], 'La réponse doit exposer la valeur normalisée.');

        $this->em()->clear();
        $stored = $this->em()->getRepository(Progress::class)->findOneBy(['anime' => $anime->getId()]);
        self::assertNotNull($stored);
        self::assertSame(25, $stored->getCurrentEpisode(), 'La base doit contenir la valeur normalisée, pas celle envoyée.');
    }

    public function testCompletedNormalisesTheChapterToTheTotal(): void
    {
        $user = $this->createUser('termine2@example.com', 'termine2');
        $manga = $this->mangaWith(139);

        $response = $this->post($user, [
            'manga' => '/api/mangas/'.$manga->getId(),
            'status' => 'COMPLETED',
        ]);

        self::assertResponseStatusCodeSame(201);
        self::assertSame(139.0, (float) $response->toArray()['currentChapter']);
    }

    /**
     * Total inconnu : « Terminé » ne peut rien normaliser, et ne doit rien casser.
     */
    public function testCompletedOnAnUnknownTotalLeavesTheCounterAlone(): void
    {
        $user = $this->createUser('termine3@example.com', 'termine3');
        $anime = $this->createAnime('Total inconnu');

        $response = $this->post($user, [
            'anime' => '/api/animes/'.$anime->getId(),
            'status' => 'COMPLETED',
            'currentEpisode' => 12,
        ]);

        self::assertResponseStatusCodeSame(201);
        self::assertSame(12, $response->toArray()['currentEpisode']);
    }

    /**
     * La normalisation vaut aussi en mise à jour : c'est le geste exact décrit par
     * l'utilisateur — basculer une œuvre déjà suivie en « Terminé ».
     */
    public function testSwitchingToCompletedNormalisesOnPatch(): void
    {
        $user = $this->createUser('bascule@example.com', 'bascule');
        $anime = $this->animeWith(25);

        $progress = (new Progress())
            ->setUser($this->reattach($user))
            ->setAnime($anime)
            ->setCurrentEpisode(3)
            ->setStatus(ProgressStatus::WATCHING);
        $this->em()->persist($progress);
        $this->em()->flush();

        $response = $this->client($this->tokenFor($this->reattach($user)))->request(
            'PATCH',
            '/api/progress/'.$progress->getId(),
            [
                'headers' => ['Content-Type' => 'application/merge-patch+json'],
                'json' => ['status' => 'COMPLETED'],
            ],
        );

        self::assertResponseStatusCodeSame(200);
        self::assertSame(25, $response->toArray()['currentEpisode']);
    }
}
