<?php

declare(strict_types=1);

namespace App\Message;

use App\Service\Anilist\AnilistMedia;

/**
 * Demande de synchronisation d'une page du catalogue AniList.
 *
 * Volontairement minimal (des entiers et des chaînes) : le message est sérialisé dans
 * la table `messenger_messages`, et le traitement est idempotent, donc un rejeu est
 * sans conséquence.
 *
 * `season`/`seasonYear` restreignent la page à un cours précis. Laissés à `null`, la
 * page est celle du classement général par popularité — le comportement historique,
 * et celui de tous les messages déjà en file au moment où ces champs ont été ajoutés.
 */
final readonly class SyncAnilistPage
{
    public function __construct(
        public string $type = AnilistMedia::TYPE_ANIME,
        public int $page = 1,
        public int $perPage = 50,
        public ?string $season = null,
        public ?int $seasonYear = null,
    ) {
    }
}
