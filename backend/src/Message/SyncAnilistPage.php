<?php

declare(strict_types=1);

namespace App\Message;

use App\Service\Anilist\AnilistMedia;

/**
 * Demande de synchronisation d'une page du catalogue AniList.
 *
 * Volontairement minimal (trois entiers/chaînes) : le message est sérialisé dans la
 * table `messenger_messages`, et le traitement est idempotent, donc un rejeu est sans
 * conséquence.
 */
final readonly class SyncAnilistPage
{
    public function __construct(
        public string $type = AnilistMedia::TYPE_ANIME,
        public int $page = 1,
        public int $perPage = 50,
    ) {
    }
}
