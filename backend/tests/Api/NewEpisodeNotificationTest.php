<?php

declare(strict_types=1);

namespace App\Tests\Api;

use ApiPlatform\Metadata\IriConverterInterface;
use App\Entity\Anime;
use App\Entity\Favorite;
use App\Entity\Notification;
use App\Entity\Progress;
use App\Entity\User;
use App\Enum\NotificationType;
use App\Message\SyncAnilistEpisodes;
use App\MessageHandler\SyncAnilistEpisodesHandler;
use App\Repository\UserRepository;
use App\Service\Anilist\AnilistEpisode;
use App\Service\Anilist\EpisodeSynchronizer;
use App\Service\Notification\NotificationTopics;
use App\Service\Notification\Notifier;
use App\Tests\Double\RecordingHub;
use App\Tests\Double\StubAnilistClient;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Log\LoggerInterface;

/**
 * Notification « nouvel épisode » sur les animes suivis.
 *
 * Le comportement testé tient en une phrase : **prévenir sur la vraie nouveauté, se
 * taire sur le remplissage initial**. Sans ce garde-fou, le premier import — 4 392
 * épisodes pour 100 animes — aurait envoyé autant de notifications qu'il y a
 * d'épisodes, à chaque abonné.
 *
 * Le handler est exercé en entier ; seul le client AniList est remplacé par un double
 * en mémoire, pour ne dépendre ni du réseau ni d'une API tierce.
 */
final class NewEpisodeNotificationTest extends ApiTestCase
{
    private StubAnilistClient $client;

    protected function setUp(): void
    {
        parent::setUp();

        $this->client = new StubAnilistClient();
    }

    private function hub(): RecordingHub
    {
        /** @var RecordingHub $hub */
        $hub = self::getContainer()->get(RecordingHub::class);

        return $hub;
    }

    /**
     * Le vrai handler, avec ses vraies dépendances — hormis le client AniList.
     */
    private function handler(): SyncAnilistEpisodesHandler
    {
        $container = self::getContainer();

        return new SyncAnilistEpisodesHandler(
            $this->client,
            $container->get(EpisodeSynchronizer::class),
            $container->get(EntityManagerInterface::class),
            $container->get(UserRepository::class),
            $container->get(Notifier::class),
            $container->get(IriConverterInterface::class),
            $container->get(LoggerInterface::class),
        );
    }

    /**
     * @param list<int> $numbers
     *
     * @return array{animes: int, created: int, updated: int, withTitle: int, notified: int}
     */
    private function importEpisodes(Anime $anime, array $numbers): array
    {
        $anilistId = (int) $this->reattach($anime)->getAnilistId();

        $this->client->willReturn(
            $anilistId,
            array_map(static fn (int $n): AnilistEpisode => new AnilistEpisode(number: $n), $numbers),
        );

        return ($this->handler())(new SyncAnilistEpisodes([$anilistId]));
    }

    private function anime(): Anime
    {
        $anime = new Anime();
        $anime->setTitleRomaji('Série suivie')->setAnilistId(random_int(800_000, 899_999));

        $this->em()->persist($anime);
        $this->em()->flush();

        return $anime;
    }

    private function favorite(User $user, Anime $anime): void
    {
        $favorite = new Favorite();
        $favorite->setUser($this->reattach($user))->setAnime($this->reattach($anime));

        $this->em()->persist($favorite);
        $this->em()->flush();
    }

    private function progress(User $user, Anime $anime): void
    {
        $progress = new Progress();
        $progress->setUser($this->reattach($user))->setAnime($this->reattach($anime))->setCurrentEpisode(1);

        $this->em()->persist($progress);
        $this->em()->flush();
    }

    /**
     * @return list<Notification>
     */
    private function notificationsOf(User $user): array
    {
        /** @var list<Notification> $notifications */
        $notifications = $this->em()->getRepository(Notification::class)
            ->findBy(['user' => $this->reattach($user), 'type' => NotificationType::NEW_EPISODE]);

        return $notifications;
    }

    public function testTheInitialBackfillNotifiesNobody(): void
    {
        $user = $this->createUser('suiveur@example.com', 'suiveur');
        $anime = $this->anime();
        $this->favorite($user, $anime);

        $stats = $this->importEpisodes($anime, range(1, 25));

        self::assertSame(25, $stats['created']);
        self::assertSame(0, $stats['notified'], 'Le premier remplissage n\'est pas un événement.');
        self::assertSame([], $this->notificationsOf($user));
        self::assertSame([], $this->hub()->updates());
    }

    public function testFollowersAreNotifiedOfAGenuinelyNewEpisode(): void
    {
        $byFavorite = $this->createUser('parfavori@example.com', 'parfavori');
        $byProgress = $this->createUser('parprogression@example.com', 'parprogression');
        $unrelated = $this->createUser('indifferent@example.com', 'indifferent');

        $anime = $this->anime();
        $this->favorite($byFavorite, $anime);
        $this->progress($byProgress, $anime);

        $this->importEpisodes($anime, [1, 2]);
        $this->hub()->reset();

        $stats = $this->importEpisodes($anime, [1, 2, 3]);

        self::assertSame(1, $stats['created']);
        self::assertSame(2, $stats['notified']);
        self::assertCount(1, $this->notificationsOf($byFavorite));
        self::assertCount(1, $this->notificationsOf($byProgress), 'Une progression suffit à suivre une série.');
        self::assertSame([], $this->notificationsOf($unrelated));

        $payload = $this->notificationsOf($byFavorite)[0]->getPayload();
        self::assertSame(3, $payload['episodeNumber']);
        self::assertSame('/api/animes/'.$this->reattach($anime)->getId(), $payload['animeIri']);
        self::assertSame('Série suivie', $payload['animeTitle']);
    }

    /**
     * Plusieurs épisodes d'un coup : une seule notification, portant le plus récent.
     * Un message par épisode inonderait la boîte dès qu'une série rattrape son retard.
     */
    public function testCatchingUpSendsASingleNotification(): void
    {
        $user = $this->createUser('rattrapage@example.com', 'rattrapage');
        $anime = $this->anime();
        $this->favorite($user, $anime);

        $this->importEpisodes($anime, [1]);
        $this->hub()->reset();

        $stats = $this->importEpisodes($anime, [1, 2, 3, 4]);

        self::assertSame(3, $stats['created']);
        self::assertSame(1, $stats['notified'], 'Une seule notification malgré trois épisodes.');

        $notifications = $this->notificationsOf($user);
        self::assertCount(1, $notifications);
        self::assertSame(4, $notifications[0]->getPayload()['episodeNumber']);
    }

    public function testTheUpdateIsPrivateAndUserScoped(): void
    {
        $user = $this->createUser('cloisonne@example.com', 'cloisonne');
        $anime = $this->anime();
        $this->favorite($user, $anime);

        $this->importEpisodes($anime, [1]);
        $this->hub()->reset();

        $this->importEpisodes($anime, [1, 2]);

        $updates = $this->hub()->updates();
        self::assertCount(1, $updates);
        self::assertTrue($updates[0]->isPrivate());
        self::assertSame(
            [NotificationTopics::forUserId((int) $this->reattach($user)->getId())],
            $updates[0]->getTopics(),
        );
    }

    /**
     * Rejouer le message — retry Messenger, relance manuelle — ne doit ni dupliquer les
     * épisodes ni renotifier.
     */
    public function testReplayingTheMessageIsHarmless(): void
    {
        $user = $this->createUser('rejeu@example.com', 'rejeu');
        $anime = $this->anime();
        $this->favorite($user, $anime);

        $this->importEpisodes($anime, [1, 2, 3]);
        $second = $this->importEpisodes($anime, [1, 2, 3]);

        self::assertSame(0, $second['created']);
        self::assertSame(0, $second['notified']);
        self::assertSame([], $this->notificationsOf($user));
    }

    public function testAnAnimeAbsentFromTheResponseIsSimplySkipped(): void
    {
        $anime = $this->anime();

        // Le client ne renvoie rien pour cet identifiant (AniList ne le connaît plus,
        // ou n'expose aucune donnée d'épisode).
        $stats = ($this->handler())(new SyncAnilistEpisodes([(int) $anime->getAnilistId()]));

        self::assertSame(0, $stats['animes']);
        self::assertSame(0, $stats['created']);
    }
}
