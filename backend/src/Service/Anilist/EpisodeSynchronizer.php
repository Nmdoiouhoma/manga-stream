<?php

declare(strict_types=1);

namespace App\Service\Anilist;

use App\Entity\Anime;
use App\Entity\Episode;
use Doctrine\ORM\EntityManagerInterface;

/**
 * Applique un lot d'{@see AnilistEpisode} aux épisodes d'un anime.
 *
 * **Idempotent** : l'upsert se fait sur le couple `(anime, number)`, qui porte déjà un
 * index unique en base. Relancer l'import ne crée aucun doublon.
 *
 * **Non destructif** : un champ déjà renseigné n'est jamais écrasé par un `null`. Un
 * passage ultérieur qui ne ramènerait plus que des numéros dérivés (AniList retire
 * régulièrement des `streamingEpisodes`) ne vide donc pas les titres déjà importés.
 *
 * Le flush est laissé à l'appelant, pour traiter un lot en une seule transaction.
 */
final class EpisodeSynchronizer
{
    public function __construct(private readonly EntityManagerInterface $entityManager)
    {
    }

    /**
     * @param list<AnilistEpisode> $episodes
     *
     * @return EpisodeSyncResult ce qui a réellement changé, pour décider des notifications
     */
    public function sync(Anime $anime, array $episodes): EpisodeSyncResult
    {
        $existing = [];
        foreach ($this->entityManager->getRepository(Episode::class)->findBy(['anime' => $anime]) as $episode) {
            $existing[$episode->getNumber()] = $episode;
        }

        $previouslyKnown = \count($existing);
        $previousHighest = [] === $existing ? 0 : max(array_keys($existing));

        $created = [];
        $updated = 0;
        $withTitle = 0;

        foreach ($episodes as $incoming) {
            $episode = $existing[$incoming->number] ?? null;

            if (null === $episode) {
                $episode = (new Episode())->setAnime($anime)->setNumber($incoming->number);
                $this->entityManager->persist($episode);
                $existing[$incoming->number] = $episode;
                $created[] = $incoming->number;
            } elseif ($this->wouldChange($episode, $incoming)) {
                ++$updated;
            }

            $this->apply($episode, $incoming);

            if (null !== $episode->getTitle()) {
                ++$withTitle;
            }
        }

        return new EpisodeSyncResult(
            created: \count($created),
            updated: $updated,
            withTitle: $withTitle,
            previouslyKnown: $previouslyKnown,
            newNumbersAbovePrevious: array_values(array_filter($created, static fn (int $n): bool => $n > $previousHighest)),
        );
    }

    /**
     * Ne recopie que ce qu'AniList a réellement fourni.
     */
    private function apply(Episode $episode, AnilistEpisode $incoming): void
    {
        if (null !== $incoming->title && null === $episode->getTitle()) {
            $episode->setTitle(self::truncate($incoming->title, 255));
        }

        if (null !== $incoming->thumbnail && null === $episode->getThumbnail()) {
            $episode->setThumbnail(self::truncate($incoming->thumbnail, 512));
        }

        if (null !== $incoming->streamUrl && null === $episode->getStreamUrl()) {
            $episode->setStreamUrl(self::truncate($incoming->streamUrl, 1024));
        }

        if (null !== $incoming->airDate && null === $episode->getAirDate()) {
            $episode->setAirDate($incoming->airDate);
        }

        if (null !== $incoming->duration && null === $episode->getDuration()) {
            $episode->setDuration($incoming->duration);
        }
    }

    private function wouldChange(Episode $episode, AnilistEpisode $incoming): bool
    {
        return (null !== $incoming->title && null === $episode->getTitle())
            || (null !== $incoming->thumbnail && null === $episode->getThumbnail())
            || (null !== $incoming->streamUrl && null === $episode->getStreamUrl())
            || (null !== $incoming->airDate && null === $episode->getAirDate())
            || (null !== $incoming->duration && null === $episode->getDuration());
    }

    /**
     * Les colonnes sont bornées ; une URL ou un titre trop long doit être tronqué et
     * non provoquer une erreur SQL au milieu d'un import de plusieurs milliers de lignes.
     */
    private static function truncate(string $value, int $max): string
    {
        return mb_strlen($value) > $max ? mb_substr($value, 0, $max) : $value;
    }
}
