<?php

declare(strict_types=1);

namespace App\MessageHandler;

use App\Message\SyncAnilistPage;
use App\Service\Anilist\AnilistClient;
use App\Service\Anilist\MediaSynchronizer;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Log\LoggerInterface;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;

/**
 * Récupère une page AniList et l'applique au catalogue.
 *
 * Le handler est idempotent : chaque média est upserté sur `anilistId`, donc rejouer
 * le message (retry Messenger, relance manuelle) ne produit aucun doublon.
 */
#[AsMessageHandler]
final class SyncAnilistPageHandler
{
    public function __construct(
        private readonly AnilistClient $client,
        private readonly MediaSynchronizer $synchronizer,
        private readonly EntityManagerInterface $entityManager,
        private readonly LoggerInterface $logger,
    ) {
    }

    /**
     * @return array{created: int, updated: int, hasNextPage: bool} statistiques (utilisées par la commande en mode `--sync`)
     */
    public function __invoke(SyncAnilistPage $message): array
    {
        $page = $this->client->fetchPage($message->type, $message->page, $message->perPage);

        $created = 0;
        $updated = 0;

        foreach ($page->media as $media) {
            if ($this->synchronizer->sync($media)) {
                ++$created;
            } else {
                ++$updated;
            }
        }

        $this->entityManager->flush();

        $this->logger->info('AniList : page synchronisée.', [
            'type' => $message->type,
            'page' => $message->page,
            'created' => $created,
            'updated' => $updated,
        ]);

        return ['created' => $created, 'updated' => $updated, 'hasNextPage' => $page->hasNextPage];
    }
}
