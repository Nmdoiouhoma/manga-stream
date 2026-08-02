<?php

declare(strict_types=1);

namespace App\Tests\Api;

use App\Entity\Anime;
use App\Entity\Favorite;
use App\Entity\Progress;
use App\Entity\User;
use App\Enum\ProgressStatus;
use App\Service\Recommendation\RecommendationEngine;

/**
 * Recommandation v1 par recouvrement de genres.
 */
final class RecommendationTest extends ApiTestCase
{
    private function favorite(User $user, object $media): void
    {
        $media = $this->reattach($media);

        $favorite = (new Favorite())->setUser($this->reattach($user));
        $media instanceof Anime ? $favorite->setAnime($media) : $favorite->setManga($media);

        $this->em()->persist($favorite);
        $this->em()->flush();
    }

    /**
     * @return list<string>
     */
    private function recommendationsFor(User $user): array
    {
        $this->client($this->tokenFor($user))->request('GET', '/api/recommendations?itemsPerPage=50', [
            'headers' => ['Accept' => 'application/json'],
        ]);
        self::assertResponseIsSuccessful();

        $items = json_decode((string) self::getClient()->getResponse()->getContent(), true);

        return array_map(
            static fn (array $r): string => $r['anime']['titleRomaji'] ?? $r['manga']['titleRomaji'],
            $items,
        );
    }

    public function testRecommendationsRequireAToken(): void
    {
        $this->client()->request('GET', '/api/recommendations');

        self::assertResponseStatusCodeSame(401);
    }

    /**
     * Sans favori, aucune préférence à extrapoler : mieux vaut une liste vide que des
     * suggestions arbitraires présentées comme personnalisées.
     */
    public function testAUserWithoutFavoritesGetsNothing(): void
    {
        $user = $this->createUser('vierge@example.com', 'vierge');
        $action = $this->createGenre('Action', 'action');
        $this->createAnime('Baki', null, null, $action);

        self::assertSame([], $this->recommendationsFor($user));
    }

    public function testWorksSharingGenresWithTheFavoritesAreSuggested(): void
    {
        $user = $this->createUser('alice@example.com', 'alice');
        $action = $this->createGenre('Action', 'action');
        $romance = $this->createGenre('Romance', 'romance');

        $favorite = $this->createAnime('Hunter x Hunter', null, null, $action);
        $this->favorite($user, $favorite);

        $this->createAnime('Baki', null, null, $action);
        $this->createManga('Vagabond', null, null, $action);
        $this->createAnime('Fruits Basket', null, null, $romance);

        $results = $this->recommendationsFor($user);

        self::assertContains('Baki', $results);
        self::assertContains('Vagabond', $results, 'Les mangas comme les animes doivent être recommandés.');
        self::assertNotContains('Fruits Basket', $results, 'Aucun genre en commun.');
    }

    public function testFavoritesAndCompletedWorksAreExcluded(): void
    {
        $user = $this->createUser('alice@example.com', 'alice');
        $action = $this->createGenre('Action', 'action');

        $favorite = $this->createAnime('Hunter x Hunter', null, null, $action);
        $this->favorite($user, $favorite);

        $completed = $this->createAnime('Gungrave', null, null, $action);
        $progress = (new Progress())
            ->setUser($this->reattach($user))
            ->setAnime($this->reattach($completed))
            ->setStatus(ProgressStatus::COMPLETED);
        $this->em()->persist($progress);
        $this->em()->flush();

        $this->createAnime('Baki', null, null, $action);

        $results = $this->recommendationsFor($user);

        self::assertContains('Baki', $results);
        self::assertNotContains('Hunter x Hunter', $results, 'Une œuvre déjà en favori ne se recommande pas.');
        self::assertNotContains('Gungrave', $results, 'Une œuvre terminée ne se recommande pas.');
    }

    public function testEachUserOnlySeesTheirOwnRecommendations(): void
    {
        $action = $this->createGenre('Action', 'action');
        $romance = $this->createGenre('Romance', 'romance');

        $alice = $this->createUser('alice@example.com', 'alice');
        $bob = $this->createUser('bob@example.com', 'bob');

        $this->favorite($alice, $this->createAnime('Hunter x Hunter', null, null, $action));
        $this->favorite($bob, $this->createAnime('Nana', null, null, $romance));

        $this->createAnime('Baki', null, null, $action);
        $this->createAnime('Fruits Basket', null, null, $romance);

        self::assertSame(['Baki'], $this->recommendationsFor($alice));
        self::assertSame(['Fruits Basket'], $this->recommendationsFor($bob));
    }

    /**
     * Plus une œuvre couvre de genres aimés, plus elle remonte.
     */
    public function testTheMostRelevantWorkComesFirst(): void
    {
        $user = $this->createUser('alice@example.com', 'alice');
        $action = $this->createGenre('Action', 'action');
        $fantasy = $this->createGenre('Fantasy', 'fantasy');

        $this->favorite($user, $this->createAnime('Berserk', null, null, $action, $fantasy));

        $this->createAnime('Partiel', null, null, $action);
        $this->createAnime('Total', null, null, $action, $fantasy);

        self::assertSame(['Total', 'Partiel'], $this->recommendationsFor($user));
    }

    public function testTheExplanationIsAttached(): void
    {
        $user = $this->createUser('alice@example.com', 'alice');
        $action = $this->createGenre('Action', 'action');

        $this->favorite($user, $this->createAnime('Hunter x Hunter', null, null, $action));
        $this->createAnime('Baki', null, null, $action);

        $this->client($this->tokenFor($user))->request('GET', '/api/recommendations', [
            'headers' => ['Accept' => 'application/json'],
        ]);

        $items = json_decode((string) self::getClient()->getResponse()->getContent(), true);
        self::assertSame('genre_cosine_idf', $items[0]['reason']['strategy']);
        self::assertSame(['action'], $items[0]['reason']['genres']);
        self::assertGreaterThan(0, $items[0]['score']);
        self::assertLessThanOrEqual(1, $items[0]['score']);
        // Les trois composantes du score doivent être exposées pour rester explicable.
        self::assertArrayHasKey('affinity', $items[0]['reason']);
        self::assertArrayHasKey('quality', $items[0]['reason']);
        self::assertArrayHasKey('popularity', $items[0]['reason']);
    }

    /**
     * Régression v1 : le score saturait à 1,0 pour la quasi-totalité des résultats,
     * qui n'étaient donc plus classés. Avec des candidats d'affinité franchement
     * différente, les scores doivent se séparer et l'ordre refléter la pertinence.
     */
    public function testScoresDiscriminateBetweenCandidates(): void
    {
        $user = $this->createUser('bob@example.com', 'bob');

        $psychological = $this->createGenre('Psychological', 'psychological');
        $thriller = $this->createGenre('Thriller', 'thriller');
        $comedy = $this->createGenre('Comedy', 'comedy');

        // Profil : psychologique + thriller.
        $this->favorite($user, $this->createAnime('Monster', null, null, $psychological, $thriller));

        // Recoupement total, recoupement partiel, recoupement minimal.
        $this->createAnime('Death Note', null, null, $psychological, $thriller);
        $this->createAnime('Erased', null, null, $thriller);
        $this->createAnime('Gintama', null, null, $comedy, $thriller);

        $this->client($this->tokenFor($user))->request('GET', '/api/recommendations', [
            'headers' => ['Accept' => 'application/json'],
        ]);

        $items = json_decode((string) self::getClient()->getResponse()->getContent(), true);
        self::assertGreaterThanOrEqual(3, \count($items));

        $scores = array_column($items, 'score');

        // Le cœur de la régression : plus un seul plateau d'ex æquo.
        self::assertCount(\count($scores), array_unique($scores), 'Les scores doivent être distincts.');

        // Et l'ordre doit être décroissant, le plus affine en tête.
        $sorted = $scores;
        rsort($sorted);
        self::assertSame($sorted, $scores, 'Les recommandations doivent être triées par score décroissant.');
        self::assertSame('Death Note', $items[0]['anime']['titleRomaji']);
    }

    /**
     * Un nouveau favori doit se répercuter sans attendre l'expiration du cache.
     */
    public function testAddingAFavoriteRefreshesTheRecommendations(): void
    {
        $user = $this->createUser('alice@example.com', 'alice');
        $action = $this->createGenre('Action', 'action');
        $romance = $this->createGenre('Romance', 'romance');

        $this->favorite($user, $this->createAnime('Hunter x Hunter', null, null, $action));
        $this->createAnime('Baki', null, null, $action);
        $this->createAnime('Fruits Basket', null, null, $romance);

        self::assertSame(['Baki'], $this->recommendationsFor($user));

        $this->favorite($user, $this->createAnime('Nana', null, null, $romance));

        $results = $this->recommendationsFor($user);
        self::assertContains('Fruits Basket', $results, 'Le nouveau genre aimé doit être pris en compte.');
        self::assertContains('Baki', $results);
    }

    public function testTheEngineIsIdempotentWithinItsFreshnessWindow(): void
    {
        $user = $this->createUser('alice@example.com', 'alice');
        $action = $this->createGenre('Action', 'action');

        $this->favorite($user, $this->createAnime('Hunter x Hunter', null, null, $action));
        $this->createAnime('Baki', null, null, $action);

        $engine = self::getContainer()->get(RecommendationEngine::class);
        $user = $this->reattach($user);
        $engine->generate($user);
        $engine->generate($user);

        $count = (int) $this->em()->createQueryBuilder()
            ->select('COUNT(r.id)')->from(\App\Entity\Recommendation::class, 'r')
            ->where('r.user = :user')->setParameter('user', $user)
            ->getQuery()->getSingleScalarResult();

        self::assertSame(1, $count, 'Un recalcul remplace les recommandations, il ne les empile pas.');
    }
}
