<?php

declare(strict_types=1);

namespace App\MessageHandler;

use ApiPlatform\Metadata\IriConverterInterface;
use App\Entity\Anime;
use App\Enum\NotificationType;
use App\Message\SyncAnilistEpisodes;
use App\Repository\UserRepository;
use App\Service\Anilist\AnilistClient;
use App\Service\Anilist\EpisodeSynchronizer;
use App\Service\Notification\Notifier;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Log\LoggerInterface;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;

/**
 * Importe les épisodes d'un lot d'animes.
 *
 * Une seule requête AniList couvre tout le lot ; le débit sortant reste donc celui de
 * la politique du client (~50 req/min), quel que soit le nombre d'animes traités.
 */
#[AsMessageHandler]
final class SyncAnilistEpisodesHandler
{
    public function __construct(
        private readonly AnilistClient $client,
        private readonly EpisodeSynchronizer $synchronizer,
        private readonly EntityManagerInterface $entityManager,
        private readonly UserRepository $users,
        private readonly Notifier $notifier,
        private readonly IriConverterInterface $iriConverter,
        private readonly LoggerInterface $logger,
    ) {
    }

    /**
     * @return array{animes: int, created: int, updated: int, withTitle: int, notified: int}
     */
    public function __invoke(SyncAnilistEpisodes $message): array
    {
        $ids = array_values(array_filter($message->anilistIds, static fn (int $id): bool => $id > 0));

        if ([] === $ids) {
            return ['animes' => 0, 'created' => 0, 'updated' => 0, 'withTitle' => 0, 'notified' => 0];
        }

        $episodesByAnilistId = $this->client->fetchEpisodes($ids);

        /** @var list<Anime> $animes */
        $animes = $this->entityManager->getRepository(Anime::class)->findBy(['anilistId' => $ids]);

        $created = $updated = $withTitle = $touched = 0;
        /** @var list<array{anime: Anime, number: int}> $announcements */
        $announcements = [];

        foreach ($animes as $anime) {
            $episodes = $episodesByAnilistId[$anime->getAnilistId()] ?? [];

            if ([] === $episodes) {
                continue;
            }

            $result = $this->synchronizer->sync($anime, $episodes);

            ++$touched;
            $created += $result->created;
            $updated += $result->updated;
            $withTitle += $result->withTitle;

            if ($result->isGenuinelyNew()) {
                $announcements[] = ['anime' => $anime, 'number' => (int) $result->highestNewNumber()];
            }
        }

        // Les épisodes sont écrits avant toute notification : une notification qui
        // renverrait vers un épisode absent de la base serait pire que pas de
        // notification du tout.
        $this->entityManager->flush();

        $notified = 0;
        foreach ($announcements as $announcement) {
            $notified += $this->announce($announcement['anime'], $announcement['number']);
        }

        $this->logger->info('AniList : épisodes synchronisés.', [
            'animes' => $touched,
            'created' => $created,
            'updated' => $updated,
            'notified' => $notified,
        ]);

        return [
            'animes' => $touched,
            'created' => $created,
            'updated' => $updated,
            'withTitle' => $withTitle,
            'notified' => $notified,
        ];
    }

    /**
     * Prévient ceux qui suivent l'anime — une seule notification par personne, portant
     * le plus haut numéro nouvellement disponible. Envoyer un message par épisode
     * inonderait la boîte dès qu'une série rattrape plusieurs semaines de retard.
     */
    private function announce(Anime $anime, int $number): int
    {
        $animeId = $anime->getId();

        if (null === $animeId) {
            return 0;
        }

        return $this->notifier->notifyAll(
            $this->users->findFollowersOfAnime($animeId),
            NotificationType::NEW_EPISODE,
            [
                'animeId' => $animeId,
                // Passée par l'IriConverter et non concaténée à la main : le client
                // suit l'IRI telle quelle, elle doit rester exacte si la route bouge.
                'animeIri' => $this->iriConverter->getIriFromResource($anime),
                'animeTitle' => $anime->getTitleRomaji(),
                'episodeNumber' => $number,
            ],
        );
    }
}
