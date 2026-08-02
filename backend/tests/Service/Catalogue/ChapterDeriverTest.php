<?php

declare(strict_types=1);

namespace App\Tests\Service\Catalogue;

use App\Entity\Chapter;
use App\Entity\Manga;
use App\Service\Catalogue\ChapterDeriver;
use Doctrine\ORM\EntityManagerInterface;
use PHPUnit\Framework\Attributes\CoversClass;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;

/**
 * Dérivation des chapitres depuis `chapterCount`.
 *
 * Rappel de ce qui est testé — et de ce qui ne peut pas l'être : AniList n'expose
 * aucune liste de chapitres, seulement leur nombre. Les assertions vérifient donc que
 * la numérotation est correcte et rejouable, et surtout qu'**aucun contenu n'est
 * inventé** (ni titre, ni date, ni URL).
 */
#[CoversClass(ChapterDeriver::class)]
final class ChapterDeriverTest extends KernelTestCase
{
    private EntityManagerInterface $entityManager;
    private ChapterDeriver $deriver;

    protected function setUp(): void
    {
        self::bootKernel();

        $this->entityManager = self::getContainer()->get(EntityManagerInterface::class);
        $this->deriver = self::getContainer()->get(ChapterDeriver::class);
    }

    private function manga(?int $chapterCount): Manga
    {
        $manga = new Manga();
        $manga->setTitleRomaji('Sonde')->setChapterCount($chapterCount);

        $this->entityManager->persist($manga);
        $this->entityManager->flush();

        return $manga;
    }

    /**
     * @return list<Chapter>
     */
    private function chaptersOf(Manga $manga): array
    {
        /** @var list<Chapter> $chapters */
        $chapters = $this->entityManager->getRepository(Chapter::class)
            ->findBy(['manga' => $manga], ['number' => 'ASC']);

        return $chapters;
    }

    public function testChaptersAreNumberedFromOne(): void
    {
        $manga = $this->manga(5);

        self::assertSame(['created' => 5, 'skipped' => 0], $this->deriver->derive($manga));
        $this->entityManager->flush();

        $chapters = $this->chaptersOf($manga);
        self::assertCount(5, $chapters);
        self::assertSame(
            ['1.00', '2.00', '3.00', '4.00', '5.00'],
            array_map(static fn (Chapter $c): string => $c->getNumber(), $chapters),
        );
    }

    public function testNoContentIsFabricated(): void
    {
        $manga = $this->manga(3);
        $this->deriver->derive($manga);
        $this->entityManager->flush();

        foreach ($this->chaptersOf($manga) as $chapter) {
            self::assertNull($chapter->getTitle(), 'AniList ne donne aucun titre de chapitre : il ne faut pas en inventer.');
            self::assertNull($chapter->getReleaseDate());
            self::assertNull($chapter->getReadUrl());
            self::assertNull($chapter->getPageCount());
        }
    }

    public function testRerunningCreatesNoDuplicate(): void
    {
        $manga = $this->manga(4);

        $this->deriver->derive($manga);
        $this->entityManager->flush();

        // La colonne est un decimal(8,2) : au second passage, les numéros relus valent
        // « 1.00 » et non « 1 ». Sans comparaison canonique, tout serait recréé.
        $second = $this->deriver->derive($manga);
        $this->entityManager->flush();

        self::assertSame(['created' => 0, 'skipped' => 4], $second);
        self::assertCount(4, $this->chaptersOf($manga));
    }

    public function testAGrowingSeriesOnlyGainsTheMissingChapters(): void
    {
        $manga = $this->manga(3);
        $this->deriver->derive($manga);
        $this->entityManager->flush();

        $manga->setChapterCount(6);
        $this->entityManager->flush();

        self::assertSame(['created' => 3, 'skipped' => 3], $this->deriver->derive($manga));
        $this->entityManager->flush();

        self::assertCount(6, $this->chaptersOf($manga));
    }

    /**
     * Beaucoup de séries en cours n'ont aucun total chez AniList. Dériver un nombre
     * qu'il ne connaît pas reviendrait à l'inventer : on préfère la fiche vide.
     */
    public function testAnUnknownCountProducesNothing(): void
    {
        $manga = $this->manga(null);

        self::assertSame(['created' => 0, 'skipped' => 0], $this->deriver->derive($manga));
        $this->entityManager->flush();

        self::assertSame([], $this->chaptersOf($manga));
    }

    public function testAberrantCountsAreCapped(): void
    {
        $manga = $this->manga(50_000);

        self::assertSame(ChapterDeriver::MAX_CHAPTERS_PER_MANGA, $this->deriver->derive($manga)['created']);
    }

    /**
     * Un chapitre bis saisi à la main (12.5) ne doit ni disparaître ni empêcher la
     * création du chapitre 12.
     */
    public function testHandEnteredHalfChaptersSurvive(): void
    {
        $manga = $this->manga(3);

        $this->entityManager->persist((new Chapter())->setManga($manga)->setNumber('2.50'));
        $this->entityManager->flush();

        self::assertSame(['created' => 3, 'skipped' => 0], $this->deriver->derive($manga));
        $this->entityManager->flush();

        self::assertSame(
            ['1.00', '2.00', '2.50', '3.00'],
            array_map(static fn (Chapter $c): string => $c->getNumber(), $this->chaptersOf($manga)),
        );
    }
}
