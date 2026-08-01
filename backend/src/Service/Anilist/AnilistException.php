<?php

declare(strict_types=1);

namespace App\Service\Anilist;

/**
 * Échec d'un appel à l'API AniList (transport, quota épuisé, erreur GraphQL).
 */
class AnilistException extends \RuntimeException
{
}
