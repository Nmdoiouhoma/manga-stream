<?php

declare(strict_types=1);

namespace App\Enum;

/**
 * Types de notifications émises par la plateforme.
 */
enum NotificationType: string
{
    case NEW_EPISODE = 'NEW_EPISODE';
    case NEW_CHAPTER = 'NEW_CHAPTER';
    case COMMENT_REPLY = 'COMMENT_REPLY';
    case RECOMMENDATION = 'RECOMMENDATION';
    case SYSTEM = 'SYSTEM';
}
