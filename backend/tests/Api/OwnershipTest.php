<?php

declare(strict_types=1);

namespace App\Tests\Api;

use App\Entity\Favorite;
use App\Entity\Notification;
use App\Entity\Progress;
use App\Entity\User;
use App\Enum\NotificationType;
use App\Enum\ProgressStatus;

/**
 * Cloisonnement des ressources personnelles.
 *
 * Le risque visé est précis : se contenter d'exiger `ROLE_USER` laisserait n'importe
 * quel compte lire les favoris, la progression et les notifications de tous les
 * autres. Ces tests vérifient qu'un utilisateur ne voit et ne touche que ses propres
 * ressources, et qu'il ne peut pas en créer au nom d'autrui.
 */
final class OwnershipTest extends ApiTestCase
{
    private function favoriteFor(User $user): Favorite
    {
        $anime = $this->createAnime('Mushishi');

        $favorite = (new Favorite())->setUser($user)->setAnime($anime);
        $this->em()->persist($favorite);
        $this->em()->flush();

        return $favorite;
    }

    public function testFavoritesRequireAToken(): void
    {
        $this->client()->request('GET', '/api/favorites');

        self::assertResponseStatusCodeSame(401);
    }

    public function testAUserOnlySeesTheirOwnFavorites(): void
    {
        $alice = $this->createUser('alice@example.com', 'alice');
        $bob = $this->createUser('bob@example.com', 'bob');

        $this->favoriteFor($alice);
        $this->favoriteFor($alice);
        $this->favoriteFor($bob);

        $this->client($this->tokenFor($alice))->request('GET', '/api/favorites');
        self::assertResponseIsSuccessful();
        self::assertJsonContains(['totalItems' => 2]);

        $this->client($this->tokenFor($bob))->request('GET', '/api/favorites');
        self::assertResponseIsSuccessful();
        self::assertJsonContains(['totalItems' => 1]);
    }

    /**
     * Un favori d'autrui doit être introuvable, et non « interdit » : un 403
     * confirmerait son existence.
     */
    public function testAnotherUsersFavoriteIsNotReadable(): void
    {
        $alice = $this->createUser('alice@example.com', 'alice');
        $bob = $this->createUser('bob@example.com', 'bob');
        $favorite = $this->favoriteFor($alice);

        $this->client($this->tokenFor($bob))->request('GET', '/api/favorites/'.$favorite->getId());

        self::assertResponseStatusCodeSame(404);
    }

    public function testAnotherUsersFavoriteCannotBeDeleted(): void
    {
        $alice = $this->createUser('alice@example.com', 'alice');
        $bob = $this->createUser('bob@example.com', 'bob');
        $favorite = $this->favoriteFor($alice);
        $id = $favorite->getId();

        $this->client($this->tokenFor($bob))->request('DELETE', '/api/favorites/'.$id);

        self::assertResponseStatusCodeSame(404);
        self::assertNotNull(
            $this->em()->getRepository(Favorite::class)->find($id),
            'Le favori d\'Alice doit toujours exister.',
        );
    }

    /**
     * Le champ `user` envoyé par le client est ignoré au profit du porteur du jeton.
     */
    public function testTheOwnerIsForcedOnCreation(): void
    {
        $alice = $this->createUser('alice@example.com', 'alice');
        $bob = $this->createUser('bob@example.com', 'bob');
        $anime = $this->createAnime('Monster');

        $this->client($this->tokenFor($bob))->request('POST', '/api/favorites', [
            'headers' => ['Content-Type' => 'application/ld+json'],
            'json' => [
                'user' => '/api/users/'.$alice->getId(),
                'anime' => '/api/animes/'.$anime->getId(),
            ],
        ]);

        self::assertResponseStatusCodeSame(201);
        self::assertJsonContains(['user' => ['id' => $bob->getId()]]);
    }

    /**
     * Le doublon doit remonter en 422 explicite, jamais en 500 exposant le SQL :
     * le client recevait « SQLSTATE[23505] ... uniq_favorite_user_anime », soit le
     * nom des tables et des index de la base.
     */
    public function testDuplicateFavoriteIsRejectedCleanly(): void
    {
        $alice = $this->createUser('alice@example.com', 'alice');
        $anime = $this->createAnime('Ping Pong the Animation');
        $payload = [
            'headers' => ['Content-Type' => 'application/ld+json'],
            'json' => ['anime' => '/api/animes/'.$anime->getId()],
        ];

        $this->client($this->tokenFor($alice))->request('POST', '/api/favorites', $payload);
        self::assertResponseStatusCodeSame(201);

        $this->client($this->tokenFor($alice))->request('POST', '/api/favorites', $payload);
        self::assertResponseStatusCodeSame(422);

        $body = (string) self::getClient()->getResponse()->getContent();
        self::assertStringNotContainsString('SQLSTATE', $body, 'Aucun détail SQL ne doit fuiter.');
        self::assertStringNotContainsString('uniq_favorite', $body);
        self::assertStringContainsString('déjà dans vos favoris', $body);
    }

    /**
     * Le propriétaire étant imposé côté serveur, le client n'a pas à envoyer `user` —
     * l'omettre ne doit pas déclencher un 422 sur un champ qu'il ne contrôle pas.
     */
    public function testOwnerMayBeOmittedFromThePayload(): void
    {
        $alice = $this->createUser('alice@example.com', 'alice');
        $anime = $this->createAnime('Dennou Coil');

        $this->client($this->tokenFor($alice))->request('POST', '/api/favorites', [
            'headers' => ['Content-Type' => 'application/ld+json'],
            'json' => ['anime' => '/api/animes/'.$anime->getId()],
        ]);

        self::assertResponseStatusCodeSame(201);
        self::assertJsonContains(['user' => ['id' => $alice->getId()]]);
    }

    public function testProgressIsScopedToItsOwner(): void
    {
        $alice = $this->createUser('alice@example.com', 'alice');
        $bob = $this->createUser('bob@example.com', 'bob');

        $progress = (new Progress())
            ->setUser($alice)
            ->setAnime($this->createAnime('Planetes'))
            ->setStatus(ProgressStatus::WATCHING);
        $this->em()->persist($progress);
        $this->em()->flush();

        $this->client($this->tokenFor($bob))->request('GET', '/api/progress');
        self::assertResponseIsSuccessful();
        self::assertJsonContains(['totalItems' => 0]);

        $this->client($this->tokenFor($bob))->request('GET', '/api/progress/'.$progress->getId());
        self::assertResponseStatusCodeSame(404);
    }

    public function testNotificationsAreScopedToTheirOwner(): void
    {
        $alice = $this->createUser('alice@example.com', 'alice');
        $bob = $this->createUser('bob@example.com', 'bob');

        $notification = (new Notification())->setUser($alice)->setType(NotificationType::SYSTEM);
        $this->em()->persist($notification);
        $this->em()->flush();

        $this->client($this->tokenFor($alice))->request('GET', '/api/notifications');
        self::assertJsonContains(['totalItems' => 1]);

        $this->client($this->tokenFor($bob))->request('GET', '/api/notifications');
        self::assertJsonContains(['totalItems' => 0]);
    }

    /**
     * `isRead` doit figurer dans les réponses. L'accesseur s'appelait `isRead()`, que
     * PropertyInfo rattache à une propriété `read` : le champ passait pour non lisible
     * et disparaissait de toutes les réponses, alors que le contrat le déclare requis.
     * Côté client, toute notification restait éternellement non lue.
     */
    public function testNotificationExposesItsReadFlag(): void
    {
        $alice = $this->createUser('alice@example.com', 'alice');

        $this->client($this->tokenFor($alice))->request('POST', '/api/notifications', [
            'headers' => ['Content-Type' => 'application/ld+json'],
            'json' => ['type' => 'SYSTEM', 'payload' => ['animeId' => 1]],
        ]);
        self::assertResponseStatusCodeSame(201);

        $created = json_decode((string) self::getClient()->getResponse()->getContent(), true);
        self::assertArrayHasKey('isRead', $created, 'isRead doit être sérialisé.');
        self::assertFalse($created['isRead']);

        $this->client($this->tokenFor($alice))->request('PATCH', $created['@id'], [
            'headers' => ['Content-Type' => 'application/merge-patch+json'],
            'json' => ['isRead' => true],
        ]);
        self::assertResponseIsSuccessful();
        self::assertJsonContains(['isRead' => true]);

        $this->client($this->tokenFor($alice))->request('GET', $created['@id']);
        self::assertJsonContains(['isRead' => true]);
    }

    /**
     * Les commentaires, eux, sont publics en lecture : seule l'écriture est restreinte.
     */
    public function testCommentsArePubliclyReadableButOnlyWritableWithAToken(): void
    {
        $anime = $this->createAnime('Texhnolyze');

        $this->client()->request('GET', '/api/comments');
        self::assertResponseIsSuccessful();

        $this->client()->request('POST', '/api/comments', [
            'headers' => ['Content-Type' => 'application/ld+json'],
            'json' => ['content' => 'Anonyme', 'anime' => '/api/animes/'.$anime->getId()],
        ]);
        self::assertResponseStatusCodeSame(401);
    }

    public function testOnlyTheAuthorOrAnAdminCanDeleteAComment(): void
    {
        $alice = $this->createUser('alice@example.com', 'alice');
        $bob = $this->createUser('bob@example.com', 'bob');
        $admin = $this->createUser('admin@example.com', 'admin', admin: true);
        $anime = $this->createAnime('Kaiba');

        $create = function (User $author) use ($anime): int {
            $this->client($this->tokenFor($author))->request('POST', '/api/comments', [
                'headers' => ['Content-Type' => 'application/ld+json'],
                'json' => ['content' => 'Un avis', 'anime' => '/api/animes/'.$anime->getId()],
            ]);
            self::assertResponseStatusCodeSame(201);

            return json_decode((string) self::getClient()->getResponse()->getContent(), true)['id'];
        };

        $id = $create($alice);
        $this->client($this->tokenFor($bob))->request('DELETE', '/api/comments/'.$id);
        self::assertResponseStatusCodeSame(403, 'Un tiers ne peut pas supprimer le commentaire.');

        $this->client($this->tokenFor($alice))->request('DELETE', '/api/comments/'.$id);
        self::assertResponseStatusCodeSame(204, 'L\'auteur peut supprimer le sien.');

        $id = $create($alice);
        $this->client($this->tokenFor($admin))->request('DELETE', '/api/comments/'.$id);
        self::assertResponseStatusCodeSame(204, 'Un administrateur peut modérer.');
    }
}
