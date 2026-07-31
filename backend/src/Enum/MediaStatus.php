<?php

declare(strict_types=1);

namespace App\Enum;

/**
 * Statut de publication/diffusion d'une œuvre (aligné sur la nomenclature AniList).
 */
enum MediaStatus: string
{
    case FINISHED = 'FINISHED';
    case RELEASING = 'RELEASING';
    case NOT_YET_RELEASED = 'NOT_YET_RELEASED';
    case CANCELLED = 'CANCELLED';
    case HIATUS = 'HIATUS';
}
