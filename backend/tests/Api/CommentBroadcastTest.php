<?php

declare(strict_types=1);

namespace App\Tests\Api;

use App\Entity\Comment;
use App\Entity\Notification;
use App\Entity\User;
use App\Service\Comment\CommentTopics;
use App\Service\Notification\NotificationTopics;
use App\Tests\Double\FailingHub;
use App\Tests\Double\RecordingHub;

/**
 * Diffusion du fil de commentaires en temps réel.
 *
 * Le manque comblé ici : seul le destinataire d'une *réponse* voyait son fil bouger,
 * parce que la seule publication existante était la notification personnelle. Un
 * commentaire racine, lui, ne produisait rien — les autres visiteurs de la fiche
 * restaient devant un fil figé jusqu'au rechargement.
 *
 * Complément de {@see MercureNotificationTest}, qui couvre l'autre publication : la
 * notification, privée et scopée par utilisateur. Les deux partent du même POST mais
 * n'ont ni le même topic, ni la même visibilité — c'est précisément ce que ce fichier
 * vérifie.
 */
final class CommentBroadcastTest extends ApiTestCase
{
    private function hub(): RecordingHub
    {
        /** @var RecordingHub $hub */
        $hub = self::getContainer()->get(RecordingHub::class);

        return $hub;
    }

    private function postComment(User $author, string $mediaIri, string $content, ?Comment $parent = null): void
    {
        $this->client($this->tokenFor($author))->request('POST', '/api/comments', [
            'headers' => ['Content-Type' => 'application/ld+json'],
            'json' => [
                'content' => $content,
                ...(str_contains($mediaIri, '/animes/') ? ['anime' => $mediaIri] : ['manga' => $mediaIri]),
                ...($parent ? ['parent' => '/api/comments/'.$parent->getId()] : []),
            ],
        ]);
    }

    /**
     * Le cas qui ne produisait rien du tout auparavant.
     */
    public function testATopLevelCommentIsBroadcastOnTheMediaThread(): void
    {
        $author = $this->createUser('diffuseur@example.com', 'diffuseur');
        $anime = $this->createAnime('Fiche observée');
        $animeId = (int) $anime->getId();

        $this->postComment($author, '/api/animes/'.$animeId, 'Un simple avis.');

        self::assertResponseStatusCodeSame(201);

        $updates = $this->hub()->updatesFor(CommentTopics::forAnimeId($animeId));
        self::assertCount(1, $updates, 'Un commentaire racine doit réveiller les fiches ouvertes.');
    }

    /**
     * **Test de sécurité, en miroir de celui des notifications.** Ici la conclusion est
     * inverse et tout aussi délibérée : le fil est partagé, donc l'update doit être
     * publique. Privée, le hub ne la remettrait qu'aux abonnés dont le JWT porte ce
     * topic — or le jeton abonné ne porte que le topic personnel de son titulaire, si
     * bien que *personne* ne recevrait jamais rien.
     */
    public function testTheBroadcastIsPublicSoEveryViewerReceivesIt(): void
    {
        $author = $this->createUser('publique@example.com', 'publique');
        $anime = $this->createAnime('Fiche partagée');
        $animeId = (int) $anime->getId();

        $this->postComment($author, '/api/animes/'.$animeId, 'Visible de tous.');

        $updates = $this->hub()->updatesFor(CommentTopics::forAnimeId($animeId));
        self::assertFalse(
            $updates[0]->isPrivate(),
            'Une update privée ne serait remise à personne : aucun jeton abonné ne porte ce topic.',
        );
    }

    /**
     * Le corps diffusé est la représentation JSON-LD du commentaire, celle que sert
     * `GET /api/comments/{id}` — le client réutilise le type généré depuis le contrat.
     */
    public function testTheBroadcastBodyMatchesTheApiRepresentation(): void
    {
        $author = $this->createUser('format@example.com', 'formatcomment');
        $anime = $this->createAnime('Fiche formatée');
        $animeId = (int) $anime->getId();

        $this->postComment($author, '/api/animes/'.$animeId, 'Contenu du message.');

        $payload = RecordingHub::payloadOf($this->hub()->updatesFor(CommentTopics::forAnimeId($animeId))[0]);

        self::assertSame('Comment', $payload['@type']);
        self::assertSame('/api/contexts/Comment', $payload['@context']);
        self::assertMatchesRegularExpression('#^/api/comments/\d+$#', (string) $payload['@id']);
        self::assertSame('Contenu du message.', $payload['content']);
        self::assertArrayHasKey('createdAt', $payload);
    }

    public function testAMangaCommentGoesOnTheMangaThread(): void
    {
        $author = $this->createUser('mangaka@example.com', 'mangaka');
        $manga = $this->createManga('Tome observé');
        $mangaId = (int) $manga->getId();

        $this->postComment($author, '/api/mangas/'.$mangaId, 'Avis sur le tome.');

        self::assertCount(1, $this->hub()->updatesFor(CommentTopics::forMangaId($mangaId)));
        self::assertSame(
            [],
            $this->hub()->updatesFor(CommentTopics::forAnimeId($mangaId)),
            'Même identifiant, autre type de média : les deux fils ne doivent pas se confondre.',
        );
    }

    /**
     * Une réponse produit **deux** publications, sur deux topics distincts et avec deux
     * visibilités opposées. C'est l'invariant central de la fonctionnalité.
     */
    public function testAReplyIsBothBroadcastAndNotified(): void
    {
        $recipient = $this->createUser('destinataire@example.com', 'destinataire');
        $author = $this->createUser('repondeur@example.com', 'repondeur');

        $anime = $this->createAnime('Fiche à répondre');
        $animeId = (int) $anime->getId();

        $parent = new Comment();
        $parent->setUser($this->reattach($recipient))->setAnime($anime)->setContent('Commentaire racine.');
        $this->em()->persist($parent);
        $this->em()->flush();

        $this->postComment($author, '/api/animes/'.$animeId, 'Ma réponse.', $parent);

        self::assertResponseStatusCodeSame(201);

        $broadcast = $this->hub()->updatesFor(CommentTopics::forAnimeId($animeId));
        self::assertCount(1, $broadcast);
        self::assertFalse($broadcast[0]->isPrivate());

        $notification = $this->hub()->updatesFor(NotificationTopics::forUserId((int) $this->reattach($recipient)->getId()));
        self::assertCount(1, $notification);
        self::assertTrue($notification[0]->isPrivate());
    }

    /**
     * Se répondre à soi-même ne notifie personne — mais le fil, lui, a bel et bien
     * bougé pour les autres visiteurs.
     */
    public function testAReplyToOneselfIsStillBroadcast(): void
    {
        $user = $this->createUser('soimeme@example.com', 'soimemebis');

        $anime = $this->createAnime('Fiche monologue');
        $animeId = (int) $anime->getId();

        $parent = new Comment();
        $parent->setUser($this->reattach($user))->setAnime($anime)->setContent('Je commence.');
        $this->em()->persist($parent);
        $this->em()->flush();

        $this->postComment($user, '/api/animes/'.$animeId, 'Je complète.', $parent);

        self::assertCount(1, $this->hub()->updatesFor(CommentTopics::forAnimeId($animeId)));
        self::assertSame([], $this->em()->getRepository(Notification::class)->findBy(['user' => $this->reattach($user)]));
    }

    /**
     * Rien de ceci n'est essentiel : le commentaire est enregistré, l'API fait foi. Un
     * hub en panne ne doit donc pas transformer une publication réussie en erreur 500.
     */
    public function testAFailingHubDoesNotBreakTheRequest(): void
    {
        $author = $this->createUser('robuste@example.com', 'robustecomment');
        $anime = $this->createAnime('Fiche sans hub');

        $client = $this->client($this->tokenFor($author));
        self::getContainer()->set(RecordingHub::class, new FailingHub());

        $client->request('POST', '/api/comments', [
            'headers' => ['Content-Type' => 'application/ld+json'],
            'json' => ['content' => 'Malgré un hub en panne.', 'anime' => '/api/animes/'.$anime->getId()],
        ]);

        self::assertResponseStatusCodeSame(201);
        self::assertCount(
            1,
            $this->em()->getRepository(Comment::class)->findBy(['anime' => $this->reattach($anime)]),
            'Le commentaire doit être en base même si sa diffusion a échoué.',
        );
    }

    public function testTheTopicConventionIsScopedByMedia(): void
    {
        self::assertSame('/api/animes/{id}/comments', CommentTopics::ANIME_TEMPLATE);
        self::assertSame('/api/mangas/{id}/comments', CommentTopics::MANGA_TEMPLATE);
        self::assertSame('/api/animes/12/comments', CommentTopics::forAnimeId(12));
        self::assertSame('/api/mangas/12/comments', CommentTopics::forMangaId(12));
    }
}
