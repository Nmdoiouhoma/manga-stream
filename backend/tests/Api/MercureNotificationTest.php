<?php

declare(strict_types=1);

namespace App\Tests\Api;

use App\Entity\Comment;
use App\Entity\Notification;
use App\Entity\User;
use App\Enum\NotificationType;
use App\Service\Notification\NotificationTopics;
use App\Tests\Double\FailingHub;
use App\Tests\Double\RecordingHub;

/**
 * Publication temps réel et cloisonnement des topics.
 *
 * Aucun appel réseau : le hub est remplacé par {@see RecordingHub} (voir
 * `config/services_test.yaml`), qui enregistre les updates au lieu de les envoyer.
 *
 * Le point le plus important de ce fichier est {@see testUpdatesArePublishedAsPrivate()} :
 * restreindre les abonnements ne cloisonne rien tant que les updates partent en
 * public, puisque le hub diffuse alors une update publique à *tous* les abonnés du
 * topic. C'est un test de sécurité, pas de confort.
 *
 * ⚠️ Un même POST produit désormais **deux** publications : la notification couverte
 * ici, et la diffusion du fil couverte par {@see CommentBroadcastTest}. Les
 * assertions de ce fichier sont donc filtrées sur le topic personnel du destinataire
 * — compter les updates du hub sans filtre reviendrait à mélanger les deux, et à
 * faire échouer ces tests au premier commentaire diffusé.
 */
final class MercureNotificationTest extends ApiTestCase
{
    private function hub(): RecordingHub
    {
        /** @var RecordingHub $hub */
        $hub = self::getContainer()->get(RecordingHub::class);

        return $hub;
    }

    /**
     * Les seules updates qui nous concernent ici : celles du topic personnel de
     * `$user`.
     *
     * @return list<\Symfony\Component\Mercure\Update>
     */
    private function notificationsFor(User $user): array
    {
        return $this->hub()->updatesFor(NotificationTopics::forUserId((int) $this->reattach($user)->getId()));
    }

    /**
     * Poste une réponse de `$author` au commentaire de `$recipient`, et retourne le hub
     * du noyau courant.
     */
    private function replyTo(Comment $parent, User $author, string $content = 'Ma réponse.'): void
    {
        $client = $this->client($this->tokenFor($author));

        $client->request('POST', '/api/comments', [
            'headers' => ['Content-Type' => 'application/ld+json'],
            'json' => [
                'content' => $content,
                'anime' => '/api/animes/'.$this->reattach($parent)->getAnime()?->getId(),
                'parent' => '/api/comments/'.$parent->getId(),
            ],
        ]);
    }

    private function rootComment(User $author): Comment
    {
        $anime = $this->createAnime('Sonde Mercure');

        $comment = new Comment();
        $comment->setUser($this->reattach($author))->setAnime($anime)->setContent('Commentaire racine.');

        $this->em()->persist($comment);
        $this->em()->flush();

        return $comment;
    }

    public function testReplyingToACommentNotifiesItsAuthor(): void
    {
        $recipient = $this->createUser('destinataire@example.com', 'destinataire');
        $author = $this->createUser('repondeur@example.com', 'repondeur');
        $parent = $this->rootComment($recipient);

        $this->replyTo($parent, $author, 'Bien vu, mais…');

        self::assertResponseStatusCodeSame(201);

        $notifications = $this->em()->getRepository(Notification::class)->findBy(['user' => $this->reattach($recipient)]);
        self::assertCount(1, $notifications, 'L\'historique doit exister en base, pas seulement passer par Mercure.');

        $notification = $notifications[0];
        self::assertSame(NotificationType::COMMENT_REPLY, $notification->getType());
        self::assertFalse($notification->getIsRead());
        self::assertSame('repondeur', $notification->getPayload()['authorUsername']);
        self::assertSame('Bien vu, mais…', $notification->getPayload()['excerpt']);
        self::assertSame('/api/comments/'.$parent->getId(), $notification->getPayload()['parentCommentIri']);
    }

    /**
     * **Test de sécurité.** Une update publique est délivrée par le hub à tout abonné
     * du topic, même si son JWT ne mentionne pas ce topic. Publier en `private` est
     * donc la seule chose qui cloisonne réellement.
     */
    public function testUpdatesArePublishedAsPrivate(): void
    {
        $recipient = $this->createUser('prive@example.com', 'prive');
        $author = $this->createUser('autre@example.com', 'autre');
        $parent = $this->rootComment($recipient);

        $this->replyTo($parent, $author);

        $updates = $this->notificationsFor($recipient);
        self::assertCount(1, $updates);
        self::assertTrue($updates[0]->isPrivate(), 'Une update publique serait diffusée à tous les abonnés du topic.');
    }

    public function testTheUpdateGoesOnlyToTheRecipientPersonalTopic(): void
    {
        $recipient = $this->createUser('cible@example.com', 'cible');
        $author = $this->createUser('emetteur@example.com', 'emetteur');
        $parent = $this->rootComment($recipient);

        $this->replyTo($parent, $author);

        $recipientId = (int) $this->reattach($recipient)->getId();
        $authorId = (int) $this->reattach($author)->getId();

        $updates = $this->notificationsFor($recipient);
        self::assertSame(
            [NotificationTopics::forUserId($recipientId)],
            $updates[0]->getTopics(),
            'Un seul topic, celui du destinataire : aucun topic générique ne doit exister.',
        );
        self::assertNotContains(NotificationTopics::forUserId($authorId), $updates[0]->getTopics());
    }

    public function testTheTopicConventionIsUserScoped(): void
    {
        $user = $this->createUser('convention@example.com', 'convention');

        self::assertSame(
            '/api/users/'.$user->getId().'/notifications',
            NotificationTopics::forUser($user),
        );
        self::assertSame('/api/users/{id}/notifications', NotificationTopics::TEMPLATE);
    }

    /**
     * Le corps publié doit être la représentation JSON-LD de la ressource, pour que le
     * client réutilise le type généré depuis le contrat au lieu d'un schéma parallèle.
     */
    public function testThePublishedBodyMatchesTheApiRepresentation(): void
    {
        $recipient = $this->createUser('format@example.com', 'format');
        $author = $this->createUser('formatbis@example.com', 'formatbis');
        $parent = $this->rootComment($recipient);

        $this->replyTo($parent, $author);

        $payload = RecordingHub::payloadOf($this->notificationsFor($recipient)[0]);

        self::assertSame('Notification', $payload['@type']);
        self::assertSame('/api/contexts/Notification', $payload['@context']);
        self::assertMatchesRegularExpression('#^/api/notifications/\d+$#', (string) $payload['@id']);
        self::assertSame('COMMENT_REPLY', $payload['type']);
        self::assertFalse($payload['isRead']);
        self::assertArrayHasKey('payload', $payload);
        self::assertArrayHasKey('createdAt', $payload);
    }

    public function testRepliesToOneselfAreNotNotified(): void
    {
        $user = $this->createUser('soimeme@example.com', 'soimeme');
        $parent = $this->rootComment($user);

        $this->replyTo($parent, $user);

        self::assertResponseStatusCodeSame(201);
        self::assertSame([], $this->notificationsFor($user), 'Se notifier soi-même gonflerait le compteur de non-lus pour rien.');
        self::assertSame([], $this->em()->getRepository(Notification::class)->findBy(['user' => $this->reattach($user)]));
    }

    /**
     * Personne n'est destinataire d'un commentaire racine : aucune notification, ni en
     * base ni sur un topic personnel. Le fil de l'œuvre, lui, est bien réveillé — c'est
     * {@see CommentBroadcastTest::testATopLevelCommentIsBroadcastOnTheMediaThread()}
     * qui le couvre.
     */
    public function testATopLevelCommentNotifiesNobody(): void
    {
        $user = $this->createUser('racine@example.com', 'racine');
        $anime = $this->createAnime('Sans réponse');

        $this->client($this->tokenFor($user))->request('POST', '/api/comments', [
            'headers' => ['Content-Type' => 'application/ld+json'],
            'json' => ['content' => 'Un simple avis.', 'anime' => '/api/animes/'.$anime->getId()],
        ]);

        self::assertResponseStatusCodeSame(201);
        self::assertSame([], $this->notificationsFor($user));
        self::assertSame([], $this->em()->getRepository(Notification::class)->findBy(['user' => $this->reattach($user)]));
    }

    /**
     * Le hub peut être injoignable : la notification reste consultable en base et la
     * requête HTTP doit aboutir malgré tout.
     */
    public function testAFailingHubDoesNotBreakTheRequest(): void
    {
        $recipient = $this->createUser('robuste@example.com', 'robuste');
        $author = $this->createUser('robustebis@example.com', 'robustebis');
        $parent = $this->rootComment($recipient);

        $client = $this->client($this->tokenFor($author));
        self::getContainer()->set(RecordingHub::class, new FailingHub());

        $client->request('POST', '/api/comments', [
            'headers' => ['Content-Type' => 'application/ld+json'],
            'json' => [
                'content' => 'Réponse malgré un hub en panne.',
                'anime' => '/api/animes/'.$this->reattach($parent)->getAnime()?->getId(),
                'parent' => '/api/comments/'.$parent->getId(),
            ],
        ]);

        self::assertResponseStatusCodeSame(201);
        self::assertCount(
            1,
            $this->em()->getRepository(Notification::class)->findBy(['user' => $this->reattach($recipient)]),
            'La base fait foi : l\'historique doit être écrit même si la publication échoue.',
        );
    }
}
