<?php

declare(strict_types=1);

namespace App\Service\Anilist;

use App\Entity\Anime;
use App\Entity\Genre;
use App\Entity\Manga;
use Doctrine\ORM\EntityManagerInterface;

/**
 * Applique un {@see AnilistMedia} au catalogue local.
 *
 * L'opération est un **upsert idempotent** basé sur `anilistId` : rejouer la même
 * synchronisation ne crée aucun doublon, elle se contente de rafraîchir les champs.
 * Les genres sont créés/réutilisés par slug.
 *
 * Le flush est laissé à l'appelant (le handler Messenger), pour pouvoir traiter une
 * page entière en une seule transaction.
 */
final class MediaSynchronizer
{
    /** @var array<string, Genre> cache local slug => Genre, évite les doublons intra-page */
    private array $genreCache = [];

    public function __construct(private readonly EntityManagerInterface $entityManager)
    {
    }

    /**
     * @return bool true si l'entité a été créée, false si elle existait déjà
     */
    public function sync(AnilistMedia $media): bool
    {
        return $media->isAnime() ? $this->syncAnime($media) : $this->syncManga($media);
    }

    private function syncAnime(AnilistMedia $media): bool
    {
        $repository = $this->entityManager->getRepository(Anime::class);
        $anime = $repository->findOneBy(['anilistId' => $media->anilistId]);
        $created = null === $anime;

        if (null === $anime) {
            $anime = new Anime();
            $anime->setAnilistId($media->anilistId);
            $this->entityManager->persist($anime);
        }

        $anime
            ->setTitleRomaji($media->titleRomaji)
            ->setTitleEnglish($media->titleEnglish)
            ->setTitleNative($media->titleNative)
            ->setSynopsis($media->synopsis)
            ->setCoverImage($media->coverImage)
            ->setBannerImage($media->bannerImage)
            ->setEpisodeCount($media->episodes)
            ->setAverageScore($media->averageScore)
            ->setStatus($media->status)
            ->setSeason($media->season)
            ->setSeasonYear($media->seasonYear)
            ->setStartDate($media->startDate)
            ->setEndDate($media->endDate)
            ->setUpdatedAt(new \DateTimeImmutable());

        $this->syncGenres($anime->getGenres(), $media->genres, $anime->addGenre(...), $anime->removeGenre(...));

        return $created;
    }

    private function syncManga(AnilistMedia $media): bool
    {
        $repository = $this->entityManager->getRepository(Manga::class);
        $manga = $repository->findOneBy(['anilistId' => $media->anilistId]);
        $created = null === $manga;

        if (null === $manga) {
            $manga = new Manga();
            $manga->setAnilistId($media->anilistId);
            $this->entityManager->persist($manga);
        }

        $manga
            ->setTitleRomaji($media->titleRomaji)
            ->setTitleEnglish($media->titleEnglish)
            ->setTitleNative($media->titleNative)
            ->setSynopsis($media->synopsis)
            ->setCoverImage($media->coverImage)
            ->setBannerImage($media->bannerImage)
            ->setChapterCount($media->chapters)
            ->setVolumeCount($media->volumes)
            ->setAverageScore($media->averageScore)
            ->setStatus($media->status)
            ->setStartDate($media->startDate)
            ->setEndDate($media->endDate)
            ->setUpdatedAt(new \DateTimeImmutable());

        $this->syncGenres($manga->getGenres(), $media->genres, $manga->addGenre(...), $manga->removeGenre(...));

        return $created;
    }

    /**
     * Aligne la collection de genres de l'entité sur celle d'AniList.
     *
     * @param \Doctrine\Common\Collections\Collection<int, Genre> $current
     * @param list<string>                                       $names
     * @param callable(Genre): mixed                             $add
     * @param callable(Genre): mixed                             $remove
     */
    private function syncGenres(iterable $current, array $names, callable $add, callable $remove): void
    {
        $wanted = [];
        foreach ($names as $name) {
            $genre = $this->resolveGenre($name);
            $wanted[$genre->getSlug()] = $genre;
        }

        $existingSlugs = [];
        foreach ($current as $genre) {
            $existingSlugs[$genre->getSlug()] = $genre;
        }

        foreach ($wanted as $slug => $genre) {
            if (!isset($existingSlugs[$slug])) {
                $add($genre);
            }
        }

        foreach ($existingSlugs as $slug => $genre) {
            if (!isset($wanted[$slug])) {
                $remove($genre);
            }
        }
    }

    private function resolveGenre(string $name): Genre
    {
        $slug = self::slugify($name);

        $cached = $this->genreCache[$slug] ?? null;
        if (null !== $cached && $this->entityManager->contains($cached)) {
            return $cached;
        }

        $genre = $this->entityManager->getRepository(Genre::class)->findOneBy(['slug' => $slug]);

        if (null === $genre) {
            $genre = (new Genre())->setName($name)->setSlug($slug);
            $this->entityManager->persist($genre);
        }

        return $this->genreCache[$slug] = $genre;
    }

    /**
     * Slug conforme à la contrainte de l'entité Genre : `^[a-z0-9]+(?:-[a-z0-9]+)*$`.
     */
    public static function slugify(string $value): string
    {
        $slug = @iconv('UTF-8', 'ASCII//TRANSLIT', $value) ?: $value;
        $slug = strtolower($slug);
        $slug = preg_replace('/[^a-z0-9]+/', '-', $slug) ?? $slug;
        $slug = trim($slug, '-');

        return '' === $slug ? 'genre-'.substr(md5($value), 0, 8) : $slug;
    }
}
