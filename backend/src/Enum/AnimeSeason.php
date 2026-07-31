<?php

declare(strict_types=1);

namespace App\Enum;

/**
 * Saison de diffusion d'un anime (nomenclature AniList).
 */
enum AnimeSeason: string
{
    case WINTER = 'WINTER';
    case SPRING = 'SPRING';
    case SUMMER = 'SUMMER';
    case FALL = 'FALL';
}
