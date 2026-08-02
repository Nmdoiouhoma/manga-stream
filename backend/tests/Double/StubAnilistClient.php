<?php

declare(strict_types=1);

namespace App\Tests\Double;

use App\Service\Anilist\AnilistClient;
use App\Service\Anilist\AnilistEpisode;

/**
 * Client AniList qui répond depuis un jeu de données en mémoire.
 *
 * Permet d'exercer `SyncAnilistEpisodesHandler` **en entier** — y compris sa logique
 * de notification, qui est le vrai sujet — sans dépendre du réseau ni de la
 * disponibilité de `graphql.anilist.co`.
 */
final class StubAnilistClient extends AnilistClient
{
    /** @var array<int, list<AnilistEpisode>> */
    private array $episodes = [];

    /** @var list<list<int>> lots d'identifiants réellement demandés */
    private array $calls = [];

    public function __construct()
    {
        // Volontairement sans appeler le constructeur parent : aucune dépendance HTTP
        // n'est nécessaire, et en instancier une donnerait l'illusion d'un vrai client.
    }

    /**
     * @param list<AnilistEpisode> $episodes
     */
    public function willReturn(int $anilistId, array $episodes): self
    {
        $this->episodes[$anilistId] = $episodes;

        return $this;
    }

    public function fetchEpisodes(array $anilistIds): array
    {
        $this->calls[] = array_values($anilistIds);

        return array_intersect_key($this->episodes, array_flip($anilistIds));
    }

    /**
     * @return list<list<int>>
     */
    public function calls(): array
    {
        return $this->calls;
    }
}
