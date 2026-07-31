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
use App\Repository\EpisodeRepository;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Serializer\Attribute\Groups;
use Symfony\Component\Validator\Constraints as Assert;

#[ORM\Entity(repositoryClass: EpisodeRepository::class)]
#[ORM\Table(name: 'episode')]
#[ORM\UniqueConstraint(name: 'uniq_episode_anime_number', columns: ['anime_id', 'number'])]
#[ApiResource(
    shortName: 'Episode',
    description: 'Épisode d\'un anime.',
    operations: [
        new GetCollection(),
        new Get(normalizationContext: ['groups' => ['episode:read', 'episode:item:read']]),
        new Post(),
        new Put(),
        new Patch(),
        new Delete(),
    ],
    normalizationContext: ['groups' => ['episode:read']],
    denormalizationContext: ['groups' => ['episode:write']],
    order: ['number' => 'ASC'],
)]
#[ApiFilter(SearchFilter::class, properties: ['anime' => 'exact', 'title' => 'ipartial', 'number' => 'exact'])]
#[ApiFilter(RangeFilter::class, properties: ['number', 'duration'])]
#[ApiFilter(OrderFilter::class, properties: ['number', 'airDate'])]
class Episode
{
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column]
    #[Groups(['episode:read', 'anime:item:read'])]
    private ?int $id = null;

    #[ORM\ManyToOne(targetEntity: Anime::class, inversedBy: 'episodes')]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    #[Assert\NotNull]
    #[Groups(['episode:read', 'episode:write'])]
    private ?Anime $anime = null;

    #[ORM\Column]
    #[Assert\Positive]
    #[Groups(['episode:read', 'episode:write', 'anime:item:read'])]
    private int $number = 1;

    #[ORM\Column(length: 255, nullable: true)]
    #[Assert\Length(max: 255)]
    #[Groups(['episode:read', 'episode:write', 'anime:item:read'])]
    private ?string $title = null;

    /**
     * Durée en minutes.
     */
    #[ORM\Column(nullable: true)]
    #[Assert\Positive]
    #[Groups(['episode:read', 'episode:write', 'anime:item:read'])]
    private ?int $duration = null;

    #[ORM\Column(type: 'date_immutable', nullable: true)]
    #[Groups(['episode:read', 'episode:write', 'anime:item:read'])]
    private ?\DateTimeImmutable $airDate = null;

    #[ORM\Column(length: 512, nullable: true)]
    #[Assert\Url]
    #[Assert\Length(max: 512)]
    #[Groups(['episode:read', 'episode:write', 'anime:item:read'])]
    private ?string $thumbnail = null;

    #[ORM\Column(length: 1024, nullable: true)]
    #[Assert\Url]
    #[Assert\Length(max: 1024)]
    #[Groups(['episode:read', 'episode:write', 'anime:item:read'])]
    private ?string $streamUrl = null;

    public function getId(): ?int
    {
        return $this->id;
    }

    public function getAnime(): ?Anime
    {
        return $this->anime;
    }

    public function setAnime(?Anime $anime): static
    {
        $this->anime = $anime;

        return $this;
    }

    public function getNumber(): int
    {
        return $this->number;
    }

    public function setNumber(int $number): static
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

    public function getDuration(): ?int
    {
        return $this->duration;
    }

    public function setDuration(?int $duration): static
    {
        $this->duration = $duration;

        return $this;
    }

    public function getAirDate(): ?\DateTimeImmutable
    {
        return $this->airDate;
    }

    public function setAirDate(?\DateTimeImmutable $airDate): static
    {
        $this->airDate = $airDate;

        return $this;
    }

    public function getThumbnail(): ?string
    {
        return $this->thumbnail;
    }

    public function setThumbnail(?string $thumbnail): static
    {
        $this->thumbnail = $thumbnail;

        return $this;
    }

    public function getStreamUrl(): ?string
    {
        return $this->streamUrl;
    }

    public function setStreamUrl(?string $streamUrl): static
    {
        $this->streamUrl = $streamUrl;

        return $this;
    }
}
