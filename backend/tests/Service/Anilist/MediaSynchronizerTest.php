<?php

declare(strict_types=1);

namespace App\Tests\Service\Anilist;

use App\Entity\Anime;
use App\Entity\Genre;
use App\Entity\Manga;
use App\Enum\MediaStatus;
use App\Service\Anilist\AnilistMedia;
use App\Service\Anilist\MediaSynchronizer;
use Doctrine\ORM\EntityManagerInterface;
use PHPUnit\Framework\Attributes\CoversClass;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;

/**
 * Idempotence de l'upsert AniList.
 *
 * La synchronisation doit pouvoir être relancée sans limite : un worker qui rejoue un
 * message, une commande relancée à la main ou un `--pages` élargi ne doivent jamais
 * dupliquer une œuvre ni un genre.
 */
#[CoversClass(MediaSynchronizer::class)]
final class MediaSynchronizerTest extends KernelTestCase
{
    private EntityManagerInterface $entityManager;
    private MediaSynchronizer $synchronizer;

    protected function setUp(): void
    {
        self::bootKernel();

        $this->entityManager = self::getContainer()->get(EntityManagerInterface::class);
        $this->synchronizer = self::getContainer()->get(MediaSynchronizer::class);
    }

    private static function media(array $overrides = []): AnilistMedia
    {
        return AnilistMedia::fromApiNode([
            'id' => 16498,
            'type' => 'ANIME',
            'title' => ['romaji' => 'Shingeki no Kyojin', 'english' => 'Attack on Titan', 'native' => '進撃の巨人'],
            'description' => 'Des titans.',
            'coverImage' => ['extraLarge' => 'https://example.com/cover.jpg'],
            'episodes' => 25,
            'averageScore' => 84,
            'status' => 'FINISHED',
            'season' => 'SPRING',
            'seasonYear' => 2013,
            'startDate' => ['year' => 2013, 'month' => 4, 'day' => 7],
            'genres' => ['Action', 'Drama'],
            ...$overrides,
        ]);
    }

    private function countRows(string $class): int
    {
        return (int) $this->entityManager->createQueryBuilder()
            ->select('COUNT(e.id)')->from($class, 'e')
            ->getQuery()->getSingleScalarResult();
    }

    public function testFirstSyncCreatesTheAnimeAndItsGenres(): void
    {
        self::assertTrue($this->synchronizer->sync(self::media()), 'Le premier passage crée l\'entité.');
        $this->entityManager->flush();

        self::assertSame(1, $this->countRows(Anime::class));
        self::assertSame(2, $this->countRows(Genre::class));

        $anime = $this->entityManager->getRepository(Anime::class)->findOneBy(['anilistId' => 16498]);
        self::assertNotNull($anime);
        self::assertSame('Shingeki no Kyojin', $anime->getTitleRomaji());
        self::assertSame('Attack on Titan', $anime->getTitleEnglish());
        self::assertSame(25, $anime->getEpisodeCount());
        self::assertSame(MediaStatus::FINISHED, $anime->getStatus());
        self::assertSame('2013-04-07', $anime->getStartDate()?->format('Y-m-d'));
        self::assertCount(2, $anime->getGenres());
    }

    /**
     * Le cœur du contrat : rejouer trois fois la même page ne doit produire
     * qu'une seule œuvre et qu'un seul jeu de genres.
     */
    public function testReplayingTheSameSyncCreatesNoDuplicate(): void
    {
        for ($i = 0; $i < 3; ++$i) {
            $created = $this->synchronizer->sync(self::media());
            $this->entityManager->flush();

            self::assertSame(0 === $i, $created, 'Seul le premier passage crée ; les suivants mettent à jour.');
        }

        self::assertSame(1, $this->countRows(Anime::class));
        self::assertSame(2, $this->countRows(Genre::class));
    }

    public function testASecondSyncRefreshesTheChangedFields(): void
    {
        $this->synchronizer->sync(self::media());
        $this->entityManager->flush();

        $this->synchronizer->sync(self::media([
            'title' => ['romaji' => 'Shingeki no Kyojin', 'english' => 'Attack on Titan (rediffusion)'],
            'averageScore' => 90,
            'episodes' => 26,
        ]));
        $this->entityManager->flush();

        $anime = $this->entityManager->getRepository(Anime::class)->findOneBy(['anilistId' => 16498]);
        self::assertNotNull($anime);
        self::assertSame(1, $this->countRows(Anime::class));
        self::assertSame('Attack on Titan (rediffusion)', $anime->getTitleEnglish());
        self::assertSame(90, $anime->getAverageScore());
        self::assertSame(26, $anime->getEpisodeCount());
    }

    /**
     * Les genres sont partagés entre animes et mangas : ils doivent être réutilisés
     * par slug, jamais recréés.
     */
    public function testGenresAreSharedBetweenAnimeAndManga(): void
    {
        $this->synchronizer->sync(self::media());
        $this->synchronizer->sync(self::media([
            'id' => 53390,
            'type' => 'MANGA',
            'title' => ['romaji' => 'Shingeki no Kyojin (manga)'],
            'chapters' => 141,
            'volumes' => 34,
            'genres' => ['Action', 'Drama', 'Mystery'],
        ]));
        $this->entityManager->flush();

        self::assertSame(1, $this->countRows(Anime::class));
        self::assertSame(1, $this->countRows(Manga::class));
        self::assertSame(3, $this->countRows(Genre::class), 'Action et Drama sont réutilisés, seul Mystery est créé.');

        $manga = $this->entityManager->getRepository(Manga::class)->findOneBy(['anilistId' => 53390]);
        self::assertNotNull($manga);
        self::assertSame(141, $manga->getChapterCount());
        self::assertSame(34, $manga->getVolumeCount());
    }

    /**
     * Un genre retiré côté AniList doit disparaître de l'œuvre — sinon la collection
     * ne ferait que grossir à chaque synchronisation.
     */
    public function testGenresRemovedUpstreamAreDetached(): void
    {
        $this->synchronizer->sync(self::media());
        $this->entityManager->flush();

        $this->synchronizer->sync(self::media(['genres' => ['Action']]));
        $this->entityManager->flush();

        $anime = $this->entityManager->getRepository(Anime::class)->findOneBy(['anilistId' => 16498]);
        self::assertNotNull($anime);
        self::assertCount(1, $anime->getGenres());
        self::assertSame('action', $anime->getGenres()->first()->getSlug());
    }

    public function testSlugify(): void
    {
        self::assertSame('slice-of-life', MediaSynchronizer::slugify('Slice of Life'));
        self::assertSame('sci-fi', MediaSynchronizer::slugify('Sci-Fi'));
        self::assertSame('mahou-shoujo', MediaSynchronizer::slugify('Mahou Shoujo'));
    }
}
