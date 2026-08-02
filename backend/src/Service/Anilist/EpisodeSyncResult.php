<?php

declare(strict_types=1);

namespace App\Service\Anilist;

/**
 * Bilan de la synchronisation des épisodes d'un anime.
 *
 * `previouslyKnown` et `newNumbersAbovePrevious` existent pour une raison précise :
 * distinguer le **premier remplissage** (0 épisode connu → N créés, ce qui n'est pas
 * un événement digne d'une notification) de la **vraie nouveauté** (un anime déjà
 * peuplé qui gagne un épisode au-delà du dernier connu). Sans cette distinction, le
 * premier import notifierait chaque abonné plusieurs milliers de fois.
 */
final readonly class EpisodeSyncResult
{
    /**
     * @param list<int> $newNumbersAbovePrevious numéros créés strictement au-dessus du plus haut numéro déjà connu
     */
    public function __construct(
        public int $created,
        public int $updated,
        public int $withTitle,
        public int $previouslyKnown,
        public array $newNumbersAbovePrevious,
    ) {
    }

    /**
     * Vrai uniquement si l'anime était déjà peuplé et vient de gagner des épisodes.
     */
    public function isGenuinelyNew(): bool
    {
        return $this->previouslyKnown > 0 && [] !== $this->newNumbersAbovePrevious;
    }

    public function highestNewNumber(): ?int
    {
        return [] === $this->newNumbersAbovePrevious ? null : max($this->newNumbersAbovePrevious);
    }
}
