<?php

declare(strict_types=1);

namespace App\Service\Anilist;

/**
 * Un épisode tel qu'AniList permet réellement de le reconstituer.
 *
 * Aucun champ n'est garanti hormis `number` : selon la série, AniList fournit soit
 * un titre et une vignette sans numéro explicite (`streamingEpisodes`), soit un
 * numéro et une date sans titre (`airingSchedule`), soit les deux, soit rien du tout.
 * `source` mémorise d'où vient l'information, ce qui rend l'import auditable.
 */
final readonly class AnilistEpisode
{
    public const SOURCE_STREAMING = 'streamingEpisodes';
    public const SOURCE_SCHEDULE = 'airingSchedule';
    public const SOURCE_DERIVED = 'derived';

    public function __construct(
        public int $number,
        public ?string $title = null,
        public ?string $thumbnail = null,
        public ?string $streamUrl = null,
        public ?\DateTimeImmutable $airDate = null,
        public ?int $duration = null,
        public string $source = self::SOURCE_DERIVED,
    ) {
    }
}
