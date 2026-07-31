<?php

declare(strict_types=1);

namespace App\Enum;

/**
 * Statut de suivi d'une œuvre par un utilisateur.
 */
enum ProgressStatus: string
{
    case WATCHING = 'WATCHING';
    case COMPLETED = 'COMPLETED';
    case PLANNED = 'PLANNED';
    case DROPPED = 'DROPPED';
    case PAUSED = 'PAUSED';
}
