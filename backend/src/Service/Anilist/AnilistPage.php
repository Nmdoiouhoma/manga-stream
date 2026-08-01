<?php

declare(strict_types=1);

namespace App\Service\Anilist;

/**
 * Une page de résultats AniList, déjà normalisée.
 */
final readonly class AnilistPage
{
    /**
     * @param list<AnilistMedia> $media
     */
    public function __construct(
        public array $media,
        public int $currentPage,
        public bool $hasNextPage,
        public ?int $total = null,
    ) {
    }
}
