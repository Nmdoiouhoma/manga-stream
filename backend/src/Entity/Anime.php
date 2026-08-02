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
use App\Enum\AnimeSeason;
use App\Enum\MediaStatus;
use App\Filter\CombinedTitleFilter;
use App\Repository\AnimeRepository;
use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Serializer\Attribute\Groups;
use Symfony\Component\Validator\Constraints as Assert;

#[ORM\Entity(repositoryClass: AnimeRepository::class)]
#[ORM\Table(name: 'anime')]
#[ORM\UniqueConstraint(name: 'uniq_anime_anilist_id', columns: ['anilist_id'])]
#[ORM\Index(name: 'idx_anime_season', columns: ['season_year', 'season'])]
#[ORM\Index(name: 'idx_anime_status', columns: ['status'])]
#[ORM\HasLifecycleCallbacks]
#[ApiResource(
    shortName: 'Anime',
    description: 'Série animée du catalogue.',
    operations: [
        new GetCollection(),
        new Get(normalizationContext: ['groups' => ['anime:read', 'anime:item:read']]),
        new Post(security: "is_granted('ROLE_ADMIN')", securityMessage: 'Seul un administrateur peut modifier le catalogue.'),
        new Put(security: "is_granted('ROLE_ADMIN')", securityMessage: 'Seul un administrateur peut modifier le catalogue.'),
        new Patch(security: "is_granted('ROLE_ADMIN')", securityMessage: 'Seul un administrateur peut modifier le catalogue.'),
        new Delete(security: "is_granted('ROLE_ADMIN')", securityMessage: 'Seul un administrateur peut modifier le catalogue.'),
    ],
    normalizationContext: ['groups' => ['anime:read']],
    denormalizationContext: ['groups' => ['anime:write']],
    order: ['titleRomaji' => 'ASC'],
)]
#[ApiFilter(SearchFilter::class, properties: [
    'titleRomaji' => 'ipartial',
    'titleEnglish' => 'ipartial',
    'titleNative' => 'ipartial',
    'status' => 'exact',
    'season' => 'exact',
    'seasonYear' => 'exact',
    'anilistId' => 'exact',
    'genres' => 'exact',
    'genres.slug' => 'exact',
])]
#[ApiFilter(CombinedTitleFilter::class)]
#[ApiFilter(RangeFilter::class, properties: ['averageScore', 'episodeCount', 'seasonYear', 'popularity'])]
#[ApiFilter(ExistsFilter::class, properties: ['bannerImage', 'anilistId'])]
#[ApiFilter(OrderFilter::class, properties: ['titleRomaji', 'averageScore', 'popularity', 'seasonYear', 'startDate', 'createdAt'])]
class Anime
{
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column]
    #[Groups(['anime:read', 'episode:read', 'favorite:read', 'progress:read', 'comment:read', 'recommendation:read'])]
    private ?int $id = null;

    /**
     * Identifiant AniList d'origine, utilisé pour l'import/synchronisation (phase 2).
     */
    #[ORM\Column(nullable: true, unique: true)]
    #[Assert\Positive]
    #[Groups(['anime:read', 'anime:write'])]
    private ?int $anilistId = null;

    #[ORM\Column(length: 255)]
    #[Assert\NotBlank]
    #[Assert\Length(max: 255)]
    #[Groups(['anime:read', 'anime:write', 'episode:read', 'favorite:read', 'progress:read', 'recommendation:read'])]
    private string $titleRomaji = '';

    #[ORM\Column(length: 255, nullable: true)]
    #[Assert\Length(max: 255)]
    #[Groups(['anime:read', 'anime:write', 'favorite:read', 'progress:read', 'recommendation:read'])]
    private ?string $titleEnglish = null;

    #[ORM\Column(length: 255, nullable: true)]
    #[Assert\Length(max: 255)]
    #[Groups(['anime:read', 'anime:write'])]
    private ?string $titleNative = null;

    #[ORM\Column(type: 'text', nullable: true)]
    #[Groups(['anime:read', 'anime:write'])]
    private ?string $synopsis = null;

    #[ORM\Column(length: 512, nullable: true)]
    #[Assert\Url]
    #[Assert\Length(max: 512)]
    #[Groups(['anime:read', 'anime:write', 'favorite:read', 'progress:read', 'recommendation:read'])]
    private ?string $coverImage = null;

    #[ORM\Column(length: 512, nullable: true)]
    #[Assert\Url]
    #[Assert\Length(max: 512)]
    #[Groups(['anime:read', 'anime:write'])]
    private ?string $bannerImage = null;

    #[ORM\Column(nullable: true)]
    #[Assert\PositiveOrZero]
    #[Groups(['anime:read', 'anime:write', 'progress:read'])]
    private ?int $episodeCount = null;

    /**
     * Score moyen sur 100 (convention AniList).
     */
    #[ORM\Column(nullable: true)]
    #[Assert\Range(min: 0, max: 100)]
    #[Groups(['anime:read', 'anime:write'])]
    private ?int $averageScore = null;

    /**
     * Nombre d'utilisateurs AniList ayant l'œuvre dans une de leurs listes.
     *
     * Sans unité et sans plafond (de quelques dizaines à plusieurs centaines de
     * milliers) : n'a de sens que comparé aux autres œuvres du catalogue. Sert de
     * critère secondaire au moteur de recommandation, qui la ramène sur [0, 1] par
     * une échelle logarithmique.
     */
    #[ORM\Column(nullable: true)]
    #[Assert\PositiveOrZero]
    #[Groups(['anime:read', 'anime:write'])]
    private ?int $popularity = null;

    #[ORM\Column(type: 'string', length: 32, nullable: true, enumType: MediaStatus::class)]
    #[Groups(['anime:read', 'anime:write'])]
    private ?MediaStatus $status = null;

    #[ORM\Column(type: 'string', length: 16, nullable: true, enumType: AnimeSeason::class)]
    #[Groups(['anime:read', 'anime:write'])]
    private ?AnimeSeason $season = null;

    #[ORM\Column(nullable: true)]
    #[Assert\Range(min: 1900, max: 2200)]
    #[Groups(['anime:read', 'anime:write'])]
    private ?int $seasonYear = null;

    #[ORM\Column(type: 'date_immutable', nullable: true)]
    #[Groups(['anime:read', 'anime:write'])]
    private ?\DateTimeImmutable $startDate = null;

    #[ORM\Column(type: 'date_immutable', nullable: true)]
    #[Groups(['anime:read', 'anime:write'])]
    private ?\DateTimeImmutable $endDate = null;

    #[ORM\Column(type: 'datetime_immutable')]
    #[Groups(['anime:read'])]
    private \DateTimeImmutable $createdAt;

    #[ORM\Column(type: 'datetime_immutable')]
    #[Groups(['anime:read'])]
    private \DateTimeImmutable $updatedAt;

    /** @var Collection<int, Genre> */
    #[ORM\ManyToMany(targetEntity: Genre::class, inversedBy: 'animes')]
    #[ORM\JoinTable(name: 'anime_genre')]
    #[Groups(['anime:read', 'anime:write'])]
    private Collection $genres;

    /** @var Collection<int, Episode> */
    #[ORM\OneToMany(targetEntity: Episode::class, mappedBy: 'anime', cascade: ['persist', 'remove'], orphanRemoval: true)]
    #[ORM\OrderBy(['number' => 'ASC'])]
    #[Groups(['anime:item:read'])]
    private Collection $episodes;

    public function __construct()
    {
        $this->genres = new ArrayCollection();
        $this->episodes = new ArrayCollection();
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

    public function getEpisodeCount(): ?int
    {
        return $this->episodeCount;
    }

    public function setEpisodeCount(?int $episodeCount): static
    {
        $this->episodeCount = $episodeCount;

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

    public function getPopularity(): ?int
    {
        return $this->popularity;
    }

    public function setPopularity(?int $popularity): static
    {
        $this->popularity = $popularity;

        return $this;
    }

    public function getStatus(): ?MediaStatus
    {
        return $this->status;
    }

    public function setStatus(?MediaStatus $status): static
    {
        $this->status = $status;

        return $this;
    }

    public function getSeason(): ?AnimeSeason
    {
        return $this->season;
    }

    public function setSeason(?AnimeSeason $season): static
    {
        $this->season = $season;

        return $this;
    }

    public function getSeasonYear(): ?int
    {
        return $this->seasonYear;
    }

    public function setSeasonYear(?int $seasonYear): static
    {
        $this->seasonYear = $seasonYear;

        return $this;
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

    /** @return Collection<int, Episode> */
    public function getEpisodes(): Collection
    {
        return $this->episodes;
    }

    public function addEpisode(Episode $episode): static
    {
        if (!$this->episodes->contains($episode)) {
            $this->episodes->add($episode);
            $episode->setAnime($this);
        }

        return $this;
    }

    public function removeEpisode(Episode $episode): static
    {
        if ($this->episodes->removeElement($episode) && $episode->getAnime() === $this) {
            $episode->setAnime(null);
        }

        return $this;
    }

    public function __toString(): string
    {
        return $this->titleRomaji;
    }
}
