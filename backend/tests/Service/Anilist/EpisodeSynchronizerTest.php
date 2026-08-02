<?php

declare(strict_types=1);

namespace App\Tests\Service\Anilist;

use App\Entity\Anime;
use App\Entity\Episode;
use App\Service\Anilist\AnilistEpisode;
use App\Service\Anilist\EpisodeSynchronizer;
use Doctrine\ORM\EntityManagerInterface;
use PHPUnit\Framework\Attributes\CoversClass;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;

/**
 * Idempotence et non-destructivité de l'import des épisodes.
 *
 * Les deux propriétés comptent autant l'une que l'autre : la synchronisation tourne en
 * boucle (worker, cron, relance manuelle) et AniList retire régulièrement des
 * `streamingEpisodes` — un second passage plus pauvre que le premier ne doit pas
 * effacer ce qui a été importé.
 */
#[CoversClass(EpisodeSynchronizer::class)]
final class EpisodeSynchronizerTest extends KernelTestCase
{
    private EntityManagerInterface $entityManager;
    private EpisodeSynchronizer $synchronizer;

    protected function setUp(): void
    {
        self::bootKernel();

        $this->entityManager = self::getContainer()->get(EntityManagerInterface::class);
        $this->synchronizer = self::getContainer()->get(EpisodeSynchronizer::class);
    }

    private function anime(): Anime
    {
        $anime = new Anime();
        $anime->setTitleRomaji('Sonde')->setAnilistId(random_int(900_000, 999_999));

        $this->entityManager->persist($anime);
        $this->entityManager->flush();

        return $anime;
    }

    /**
     * @return list<Episode>
     */
    private function episodesOf(Anime $anime): array
    {
        /** @var list<Episode> $episodes */
        $episodes = $this->entityManager->getRepository(Episode::class)
            ->findBy(['anime' => $anime], ['number' => 'ASC']);

        return $episodes;
    }

    public function testEpisodesArePersisted(): void
    {
        $anime = $this->anime();

        $result = $this->synchronizer->sync($anime, [
            new AnilistEpisode(number: 1, title: 'Premier', thumbnail: 'https://cdn.example/1.jpg', streamUrl: 'https://stream.example/1', airDate: new \DateTimeImmutable('2019-04-06'), duration: 24),
            new AnilistEpisode(number: 2, duration: 24),
        ]);

        $this->entityManager->flush();

        self::assertSame(2, $result->created);
        self::assertSame(0, $result->previouslyKnown);

        $episodes = $this->episodesOf($anime);
        self::assertCount(2, $episodes);
        self::assertSame('Premier', $episodes[0]->getTitle());
        self::assertSame('2019-04-06', $episodes[0]->getAirDate()?->format('Y-m-d'));
        self::assertNull($episodes[1]->getTitle(), 'Un épisade dérivé reste sans titre.');
    }

    public function testRerunningCreatesNoDuplicate(): void
    {
        $anime = $this->anime();
        $batch = [
            new AnilistEpisode(number: 1, title: 'Premier', duration: 24),
            new AnilistEpisode(number: 2, title: 'Second', duration: 24),
        ];

        $this->synchronizer->sync($anime, $batch);
        $this->entityManager->flush();

        $second = $this->synchronizer->sync($anime, $batch);
        $this->entityManager->flush();

        self::assertSame(0, $second->created, 'Le second passage ne doit rien créer.');
        self::assertSame(2, $second->previouslyKnown);
        self::assertCount(2, $this->episodesOf($anime));
    }

    public function testAnExistingTitleIsNeverErasedByALaterEmptyPass(): void
    {
        $anime = $this->anime();

        $this->synchronizer->sync($anime, [
            new AnilistEpisode(number: 1, title: 'Titre importé', streamUrl: 'https://stream.example/1', duration: 24),
        ]);
        $this->entityManager->flush();

        // Passage suivant : AniList ne renvoie plus que le numéro.
        $this->synchronizer->sync($anime, [new AnilistEpisode(number: 1, duration: 24)]);
        $this->entityManager->flush();

        $episode = $this->episodesOf($anime)[0];
        self::assertSame('Titre importé', $episode->getTitle());
        self::assertSame('https://stream.example/1', $episode->getStreamUrl());
    }

    /**
     * Un passage ultérieur, lui, doit bien compléter ce qui manquait.
     */
    public function testALaterPassCompletesMissingFields(): void
    {
        $anime = $this->anime();

        $this->synchronizer->sync($anime, [new AnilistEpisode(number: 1, duration: 24)]);
        $this->entityManager->flush();

        $result = $this->synchronizer->sync($anime, [
            new AnilistEpisode(number: 1, title: 'Titre arrivé plus tard', duration: 24),
        ]);
        $this->entityManager->flush();

        self::assertSame(0, $result->created);
        self::assertSame(1, $result->updated);
        self::assertSame('Titre arrivé plus tard', $this->episodesOf($anime)[0]->getTitle());
    }

    /**
     * Le premier remplissage ne doit surtout pas passer pour de la nouveauté : c'est ce
     * qui empêche l'import initial de notifier chaque abonné des milliers de fois.
     */
    public function testTheInitialFillIsNotConsideredNew(): void
    {
        $anime = $this->anime();

        $result = $this->synchronizer->sync($anime, [
            new AnilistEpisode(number: 1),
            new AnilistEpisode(number: 2),
        ]);
        $this->entityManager->flush();

        self::assertFalse($result->isGenuinelyNew());
    }

    public function testAnEpisodeAddedLaterCountsAsGenuinelyNew(): void
    {
        $anime = $this->anime();

        $this->synchronizer->sync($anime, [new AnilistEpisode(number: 1), new AnilistEpisode(number: 2)]);
        $this->entityManager->flush();

        $result = $this->synchronizer->sync($anime, [
            new AnilistEpisode(number: 1),
            new AnilistEpisode(number: 2),
            new AnilistEpisode(number: 3, title: 'Nouveau'),
            new AnilistEpisode(number: 4),
        ]);
        $this->entityManager->flush();

        self::assertTrue($result->isGenuinelyNew());
        self::assertSame([3, 4], $result->newNumbersAbovePrevious);
        self::assertSame(4, $result->highestNewNumber(), 'Une seule notification, portant le plus haut numéro.');
    }

    /**
     * Combler un trou *sous* le plus haut numéro connu n'est pas une nouveauté : c'est
     * un rattrapage de catalogue, et prévenir les abonnés serait trompeur.
     */
    public function testFillingAGapBelowTheHighestKnownIsNotNew(): void
    {
        $anime = $this->anime();

        $this->synchronizer->sync($anime, [new AnilistEpisode(number: 1), new AnilistEpisode(number: 5)]);
        $this->entityManager->flush();

        $result = $this->synchronizer->sync($anime, [new AnilistEpisode(number: 3)]);
        $this->entityManager->flush();

        self::assertSame(1, $result->created);
        self::assertFalse($result->isGenuinelyNew());
    }

    public function testOverlongValuesAreTruncatedRatherThanBlowingUpTheInsert(): void
    {
        $anime = $this->anime();

        $this->synchronizer->sync($anime, [
            new AnilistEpisode(number: 1, title: str_repeat('é', 400)),
        ]);
        $this->entityManager->flush();

        self::assertSame(255, mb_strlen((string) $this->episodesOf($anime)[0]->getTitle()));
    }
}
