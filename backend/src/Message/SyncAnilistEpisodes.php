<?php

declare(strict_types=1);

namespace App\Message;

/**
 * Demande d'import des épisodes pour un lot d'animes déjà présents au catalogue.
 *
 * Le message ne transporte que des identifiants AniList : le traitement est un upsert
 * sur `(anime, number)`, donc un rejeu (retry Messenger, relance manuelle) est sans
 * conséquence.
 */
final readonly class SyncAnilistEpisodes
{
    /**
     * @param list<int> $anilistIds au plus AnilistClient::EPISODE_BATCH_SIZE identifiants
     */
    public function __construct(public array $anilistIds)
    {
    }
}
