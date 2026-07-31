<?php

declare(strict_types=1);

namespace App\Entity;

use ApiPlatform\Doctrine\Orm\Filter\OrderFilter;
use ApiPlatform\Doctrine\Orm\Filter\RangeFilter;
use ApiPlatform\Doctrine\Orm\Filter\SearchFilter;
use ApiPlatform\Metadata\ApiFilter;
use ApiPlatform\Metadata\ApiResource;
use ApiPlatform\Metadata\Delete;
use ApiPlatform\Metadata\Get;
use ApiPlatform\Metadata\GetCollection;
use ApiPlatform\Metadata\Patch;
use ApiPlatform\Metadata\Post;
use ApiPlatform\Metadata\Put;
use App\Repository\ChapterRepository;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Serializer\Attribute\Groups;
use Symfony\Component\Validator\Constraints as Assert;

#[ORM\Entity(repositoryClass: ChapterRepository::class)]
#[ORM\Table(name: 'chapter')]
#[ORM\UniqueConstraint(name: 'uniq_chapter_manga_number', columns: ['manga_id', 'number'])]
#[ApiResource(
    shortName: 'Chapter',
    description: 'Chapitre d\'un manga.',
    operations: [
        new GetCollection(),
        new Get(normalizationContext: ['groups' => ['chapter:read', 'chapter:item:read']]),
        new Post(),
        new Put(),
        new Patch(),
        new Delete(),
    ],
    normalizationContext: ['groups' => ['chapter:read']],
    denormalizationContext: ['groups' => ['chapter:write']],
    order: ['number' => 'ASC'],
)]
#[ApiFilter(SearchFilter::class, properties: ['manga' => 'exact', 'title' => 'ipartial', 'number' => 'exact'])]
#[ApiFilter(RangeFilter::class, properties: ['number', 'pageCount'])]
#[ApiFilter(OrderFilter::class, properties: ['number', 'releaseDate'])]
class Chapter
{
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column]
    #[Groups(['chapter:read', 'manga:item:read'])]
    private ?int $id = null;

    #[ORM\ManyToOne(targetEntity: Manga::class, inversedBy: 'chapters')]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    #[Assert\NotNull]
    #[Groups(['chapter:read', 'chapter:write'])]
    private ?Manga $manga = null;

    /**
     * Numéro de chapitre, en décimal pour supporter les chapitres bis (ex : 12.5).
     */
    #[ORM\Column(type: 'decimal', precision: 8, scale: 2)]
    #[Assert\NotNull]
    #[Assert\Positive]
    #[Groups(['chapter:read', 'chapter:write', 'manga:item:read'])]
    private string $number = '1.00';

    #[ORM\Column(length: 255, nullable: true)]
    #[Assert\Length(max: 255)]
    #[Groups(['chapter:read', 'chapter:write', 'manga:item:read'])]
    private ?string $title = null;

    #[ORM\Column(nullable: true)]
    #[Assert\Positive]
    #[Groups(['chapter:read', 'chapter:write', 'manga:item:read'])]
    private ?int $pageCount = null;

    #[ORM\Column(type: 'date_immutable', nullable: true)]
    #[Groups(['chapter:read', 'chapter:write', 'manga:item:read'])]
    private ?\DateTimeImmutable $releaseDate = null;

    #[ORM\Column(length: 1024, nullable: true)]
    #[Assert\Url]
    #[Assert\Length(max: 1024)]
    #[Groups(['chapter:read', 'chapter:write', 'manga:item:read'])]
    private ?string $readUrl = null;

    public function getId(): ?int
    {
        return $this->id;
    }

    public function getManga(): ?Manga
    {
        return $this->manga;
    }

    public function setManga(?Manga $manga): static
    {
        $this->manga = $manga;

        return $this;
    }

    public function getNumber(): string
    {
        return $this->number;
    }

    public function setNumber(string $number): static
    {
        $this->number = $number;

        return $this;
    }

    public function getTitle(): ?string
    {
        return $this->title;
    }

    public function setTitle(?string $title): static
    {
        $this->title = $title;

        return $this;
    }

    public function getPageCount(): ?int
    {
        return $this->pageCount;
    }

    public function setPageCount(?int $pageCount): static
    {
        $this->pageCount = $pageCount;

        return $this;
    }

    public function getReleaseDate(): ?\DateTimeImmutable
    {
        return $this->releaseDate;
    }

    public function setReleaseDate(?\DateTimeImmutable $releaseDate): static
    {
        $this->releaseDate = $releaseDate;

        return $this;
    }

    public function getReadUrl(): ?string
    {
        return $this->readUrl;
    }

    public function setReadUrl(?string $readUrl): static
    {
        $this->readUrl = $readUrl;

        return $this;
    }
}
