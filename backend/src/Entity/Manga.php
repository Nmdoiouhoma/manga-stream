<?php

declare(strict_types=1);

namespace App\Entity;

use ApiPlatform\Doctrine\Orm\Filter\ExistsFilter;
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
use App\Enum\MediaStatus;
use App\Filter\CombinedTitleFilter;
use App\Repository\MangaRepository;
use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Serializer\Attribute\Groups;
use Symfony\Component\Validator\Constraints as Assert;

#[ORM\Entity(repositoryClass: MangaRepository::class)]
#[ORM\Table(name: 'manga')]
#[ORM\UniqueConstraint(name: 'uniq_manga_anilist_id', columns: ['anilist_id'])]
#[ORM\Index(name: 'idx_manga_status', columns: ['status'])]
#[ORM\HasLifecycleCallbacks]
#[ApiResource(
    shortName: 'Manga',
    description: 'Œuvre papier / webtoon du catalogue.',
    operations: [
        new GetCollection(),
        new Get(normalizationContext: ['groups' => ['manga:read', 'manga:item:read']]),
        new Post(security: "is_granted('ROLE_ADMIN')", securityMessage: 'Seul un administrateur peut modifier le catalogue.'),
        new Put(security: "is_granted('ROLE_ADMIN')", securityMessage: 'Seul un administrateur peut modifier le catalogue.'),
        new Patch(security: "is_granted('ROLE_ADMIN')", securityMessage: 'Seul un administrateur peut modifier le catalogue.'),
        new Delete(security: "is_granted('ROLE_ADMIN')", securityMessage: 'Seul un administrateur peut modifier le catalogue.'),
    ],
    normalizationContext: ['groups' => ['manga:read']],
    denormalizationContext: ['groups' => ['manga:write']],
    order: ['titleRomaji' => 'ASC'],
)]
#[ApiFilter(SearchFilter::class, properties: [
    'titleRomaji' => 'ipartial',
    'titleEnglish' => 'ipartial',
    'titleNative' => 'ipartial',
    'status' => 'exact',
    'anilistId' => 'exact',
    'genres' => 'exact',
    'genres.slug' => 'exact',
])]
#[ApiFilter(CombinedTitleFilter::class)]
#[ApiFilter(RangeFilter::class, properties: ['averageScore', 'chapterCount', 'volumeCount'])]
#[ApiFilter(ExistsFilter::class, properties: ['bannerImage', 'anilistId'])]
#[ApiFilter(OrderFilter::class, properties: ['titleRomaji', 'averageScore', 'chapterCount', 'createdAt'])]
class Manga
{
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column]
    #[Groups(['manga:read', 'chapter:read', 'favorite:read', 'progress:read', 'comment:read', 'recommendation:read'])]
    private ?int $id = null;

    #[ORM\Column(nullable: true, unique: true)]
    #[Assert\Positive]
    #[Groups(['manga:read', 'manga:write'])]
    private ?int $anilistId = null;

    #[ORM\Column(length: 255)]
    #[Assert\NotBlank]
    #[Assert\Length(max: 255)]
    #[Groups(['manga:read', 'manga:write', 'chapter:read', 'favorite:read', 'progress:read', 'recommendation:read'])]
    private string $titleRomaji = '';

    #[ORM\Column(length: 255, nullable: true)]
    #[Assert\Length(max: 255)]
    #[Groups(['manga:read', 'manga:write', 'favorite:read', 'progress:read', 'recommendation:read'])]
    private ?string $titleEnglish = null;

    #[ORM\Column(length: 255, nullable: true)]
    #[Assert\Length(max: 255)]
    #[Groups(['manga:read', 'manga:write'])]
    private ?string $titleNative = null;

    #[ORM\Column(type: 'text', nullable: true)]
    #[Groups(['manga:read', 'manga:write'])]
    private ?string $synopsis = null;

    #[ORM\Column(length: 512, nullable: true)]
    #[Assert\Url]
    #[Assert\Length(max: 512)]
    #[Groups(['manga:read', 'manga:write', 'favorite:read', 'progress:read', 'recommendation:read'])]
    private ?string $coverImage = null;

    #[ORM\Column(length: 512, nullable: true)]
    #[Assert\Url]
    #[Assert\Length(max: 512)]
    #[Groups(['manga:read', 'manga:write'])]
    private ?string $bannerImage = null;

    #[ORM\Column(nullable: true)]
    #[Assert\PositiveOrZero]
    #[Groups(['manga:read', 'manga:write', 'progress:read'])]
    private ?int $chapterCount = null;

    #[ORM\Column(nullable: true)]
    #[Assert\PositiveOrZero]
    #[Groups(['manga:read', 'manga:write'])]
    private ?int $volumeCount = null;

    /**
     * Score moyen sur 100 (convention AniList).
     */
    #[ORM\Column(nullable: true)]
    #[Assert\Range(min: 0, max: 100)]
    #[Groups(['manga:read', 'manga:write'])]
    private ?int $averageScore = null;

    #[ORM\Column(type: 'string', length: 32, nullable: true, enumType: MediaStatus::class)]
    #[Groups(['manga:read', 'manga:write'])]
    private ?MediaStatus $status = null;

    /**
     * Début de publication (renseigné par la synchronisation AniList).
     */
    #[ORM\Column(type: 'date_immutable', nullable: true)]
    #[Groups(['manga:read', 'manga:write'])]
    private ?\DateTimeImmutable $startDate = null;

    #[ORM\Column(type: 'date_immutable', nullable: true)]
    #[Groups(['manga:read', 'manga:write'])]
    private ?\DateTimeImmutable $endDate = null;

    #[ORM\Column(type: 'datetime_immutable')]
    #[Groups(['manga:read'])]
    private \DateTimeImmutable $createdAt;

    #[ORM\Column(type: 'datetime_immutable')]
    #[Groups(['manga:read'])]
    private \DateTimeImmutable $updatedAt;

    /** @var Collection<int, Genre> */
    #[ORM\ManyToMany(targetEntity: Genre::class, inversedBy: 'mangas')]
    #[ORM\JoinTable(name: 'manga_genre')]
    #[Groups(['manga:read', 'manga:write'])]
    private Collection $genres;

    /** @var Collection<int, Chapter> */
    #[ORM\OneToMany(targetEntity: Chapter::class, mappedBy: 'manga', cascade: ['persist', 'remove'], orphanRemoval: true)]
    #[ORM\OrderBy(['number' => 'ASC'])]
    #[Groups(['manga:item:read'])]
    private Collection $chapters;

    public function __construct()
    {
        $this->genres = new ArrayCollection();
        $this->chapters = new ArrayCollection();
        $this->createdAt = new \DateTimeImmutable();
        $this->updatedAt = new \DateTimeImmutable();
    }

    #[ORM\PreUpdate]
    public function touch(): void
    {
        $this->updatedAt = new \DateTimeImmutable();
    }

    public function getId(): ?int
    {
        return $this->id;
    }

    public function getAnilistId(): ?int
    {
        return $this->anilistId;
    }

    public function setAnilistId(?int $anilistId): static
    {
        $this->anilistId = $anilistId;

        return $this;
    }

    public function getTitleRomaji(): string
    {
        return $this->titleRomaji;
    }

    public function setTitleRomaji(string $titleRomaji): static
    {
        $this->titleRomaji = $titleRomaji;

        return $this;
    }

    public function getTitleEnglish(): ?string
    {
        return $this->titleEnglish;
    }

    public function setTitleEnglish(?string $titleEnglish): static
    {
        $this->titleEnglish = $titleEnglish;

        return $this;
    }

    public function getTitleNative(): ?string
    {
        return $this->titleNative;
    }

    public function setTitleNative(?string $titleNative): static
    {
        $this->titleNative = $titleNative;

        return $this;
    }

    public function getSynopsis(): ?string
    {
        return $this->synopsis;
    }

    public function setSynopsis(?string $synopsis): static
    {
        $this->synopsis = $synopsis;

        return $this;
    }

    public function getCoverImage(): ?string
    {
        return $this->coverImage;
    }

    public function setCoverImage(?string $coverImage): static
    {
        $this->coverImage = $coverImage;

        return $this;
    }

    public function getBannerImage(): ?string
    {
        return $this->bannerImage;
    }

    public function setBannerImage(?string $bannerImage): static
    {
        $this->bannerImage = $bannerImage;

        return $this;
    }

    public function getChapterCount(): ?int
    {
        return $this->chapterCount;
    }

    public function setChapterCount(?int $chapterCount): static
    {
        $this->chapterCount = $chapterCount;

        return $this;
    }

    public function getVolumeCount(): ?int
    {
        return $this->volumeCount;
    }

    public function setVolumeCount(?int $volumeCount): static
    {
        $this->volumeCount = $volumeCount;

        return $this;
    }

    public function getAverageScore(): ?int
    {
        return $this->averageScore;
    }

    public function setAverageScore(?int $averageScore): static
    {
        $this->averageScore = $averageScore;

        return $this;
    }

    public function getStatus(): ?MediaStatus
    {
        return $this->status;
    }

    public function getStartDate(): ?\DateTimeImmutable
    {
        return $this->startDate;
    }

    public function setStartDate(?\DateTimeImmutable $startDate): static
    {
        $this->startDate = $startDate;

        return $this;
    }

    public function getEndDate(): ?\DateTimeImmutable
    {
        return $this->endDate;
    }

    public function setEndDate(?\DateTimeImmutable $endDate): static
    {
        $this->endDate = $endDate;

        return $this;
    }

    public function setStatus(?MediaStatus $status): static
    {
        $this->status = $status;

        return $this;
    }

    public function getCreatedAt(): \DateTimeImmutable
    {
        return $this->createdAt;
    }

    public function setCreatedAt(\DateTimeImmutable $createdAt): static
    {
        $this->createdAt = $createdAt;

        return $this;
    }

    public function getUpdatedAt(): \DateTimeImmutable
    {
        return $this->updatedAt;
    }

    public function setUpdatedAt(\DateTimeImmutable $updatedAt): static
    {
        $this->updatedAt = $updatedAt;

        return $this;
    }

    /** @return Collection<int, Genre> */
    public function getGenres(): Collection
    {
        return $this->genres;
    }

    public function addGenre(Genre $genre): static
    {
        if (!$this->genres->contains($genre)) {
            $this->genres->add($genre);
        }

        return $this;
    }

    public function removeGenre(Genre $genre): static
    {
        $this->genres->removeElement($genre);

        return $this;
    }

    /** @return Collection<int, Chapter> */
    public function getChapters(): Collection
    {
        return $this->chapters;
    }

    public function addChapter(Chapter $chapter): static
    {
        if (!$this->chapters->contains($chapter)) {
            $this->chapters->add($chapter);
            $chapter->setManga($this);
        }

        return $this;
    }

    public function removeChapter(Chapter $chapter): static
    {
        if ($this->chapters->removeElement($chapter) && $chapter->getManga() === $this) {
            $chapter->setManga(null);
        }

        return $this;
    }

    public function __toString(): string
    {
        return $this->titleRomaji;
    }
}
