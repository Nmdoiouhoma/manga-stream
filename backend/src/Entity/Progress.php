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
use App\Enum\ProgressStatus;
use App\Repository\ProgressRepository;
use App\Validator\CoherentProgress;
use App\Validator\ExactlyOneMediaTarget;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Bridge\Doctrine\Validator\Constraints\UniqueEntity;
use Symfony\Component\Serializer\Attribute\Groups;
use Symfony\Component\Validator\Constraints as Assert;

/**
 * Avancement d'un utilisateur sur un anime OU un manga.
 */
#[ORM\Entity(repositoryClass: ProgressRepository::class)]
#[ORM\Table(name: 'progress')]
#[ORM\UniqueConstraint(name: 'uniq_progress_user_anime', columns: ['user_id', 'anime_id'])]
#[ORM\UniqueConstraint(name: 'uniq_progress_user_manga', columns: ['user_id', 'manga_id'])]
#[ORM\Index(name: 'idx_progress_status', columns: ['status'])]
#[ORM\HasLifecycleCallbacks]
#[ExactlyOneMediaTarget]
#[CoherentProgress]
// Une seule progression par utilisateur et par œuvre (cf. index uniques).
#[UniqueEntity(fields: ['user', 'anime'], message: 'Vous suivez déjà cet anime.')]
#[UniqueEntity(fields: ['user', 'manga'], message: 'Vous suivez déjà ce manga.')]
#[ApiResource(
    shortName: 'Progress',
    description: <<<'TXT'
        Suivi de visionnage/lecture d'un utilisateur.

        Cohérence imposée par l'API (422 `application/problem+json` sinon) :
        `currentEpisode` n'a de sens que sur un anime, `currentChapter` que sur un
        manga, et ni l'un ni l'autre ne peut dépasser le total de l'œuvre lorsqu'il
        est connu (`episodeCount` / `chapterCount` sont null pour une série en cours :
        aucune borne haute n'est alors appliquée).

        `status: COMPLETED` est en revanche NORMALISÉ, pas rejeté : le compteur est
        porté au total de l'œuvre et la valeur corrigée est renvoyée dans la réponse.
        Un `{"status": "COMPLETED", "currentEpisode": 1}` sur une série de 25 épisodes
        est donc enregistré à 25.
        TXT,
    operations: [
        new GetCollection(security: "is_granted('ROLE_USER')"),
        new Get(
            normalizationContext: ['groups' => ['progress:read', 'progress:item:read']],
            security: "is_granted('ROLE_USER') and object.getUser() === user", securityMessage: 'Cette ressource appartient à un autre utilisateur.',
        ),
        new Post(security: "is_granted('ROLE_USER')"),
        new Put(security: "is_granted('ROLE_USER') and object.getUser() === user", securityMessage: 'Cette ressource appartient à un autre utilisateur.'),
        new Patch(security: "is_granted('ROLE_USER') and object.getUser() === user", securityMessage: 'Cette ressource appartient à un autre utilisateur.'),
        new Delete(security: "is_granted('ROLE_USER') and object.getUser() === user", securityMessage: 'Cette ressource appartient à un autre utilisateur.'),
    ],
    normalizationContext: ['groups' => ['progress:read']],
    denormalizationContext: ['groups' => ['progress:write']],
    order: ['updatedAt' => 'DESC'],
)]
#[ApiFilter(SearchFilter::class, properties: ['user' => 'exact', 'anime' => 'exact', 'manga' => 'exact', 'status' => 'exact'])]
#[ApiFilter(ExistsFilter::class, properties: ['anime', 'manga', 'score'])]
#[ApiFilter(RangeFilter::class, properties: ['score', 'currentEpisode'])]
#[ApiFilter(OrderFilter::class, properties: ['updatedAt', 'score'])]
class Progress implements OwnedByUser
{
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column]
    #[Groups(['progress:read'])]
    private ?int $id = null;

    /**
     * Propriétaire de la ressource. Volontairement sans `Assert\NotNull` : il est
     * imposé à partir du jeton par {@see \App\State\UserOwnedProvider}, qui s'exécute
     * avant la validation. Le rendre obligatoire ici forcerait le client à envoyer une
     * valeur de toute façon écrasée, et lui renverrait un 422 déroutant s'il l'omet.
     * La colonne reste NOT NULL en base : l'intégrité est garantie là où il faut.
     */
    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    #[Groups(['progress:read', 'progress:write'])]
    private ?User $user = null;

    #[ORM\ManyToOne(targetEntity: Anime::class)]
    #[ORM\JoinColumn(nullable: true, onDelete: 'CASCADE')]
    #[Groups(['progress:read', 'progress:write'])]
    private ?Anime $anime = null;

    #[ORM\ManyToOne(targetEntity: Manga::class)]
    #[ORM\JoinColumn(nullable: true, onDelete: 'CASCADE')]
    #[Groups(['progress:read', 'progress:write'])]
    private ?Manga $manga = null;

    #[ORM\Column(nullable: true)]
    #[Assert\PositiveOrZero]
    #[Groups(['progress:read', 'progress:write'])]
    private ?int $currentEpisode = null;

    /**
     * Numéro de chapitre courant, décimal pour supporter les chapitres bis.
     */
    #[ORM\Column(type: 'decimal', precision: 8, scale: 2, nullable: true)]
    #[Assert\PositiveOrZero]
    #[Groups(['progress:read', 'progress:write'])]
    private ?string $currentChapter = null;

    #[ORM\Column(type: 'string', length: 16, enumType: ProgressStatus::class)]
    #[Assert\NotNull]
    #[Groups(['progress:read', 'progress:write'])]
    private ProgressStatus $status = ProgressStatus::PLANNED;

    /**
     * Note personnelle de l'utilisateur, sur 100.
     */
    #[ORM\Column(nullable: true)]
    #[Assert\Range(min: 0, max: 100)]
    #[Groups(['progress:read', 'progress:write'])]
    private ?int $score = null;

    #[ORM\Column(type: 'datetime_immutable')]
    #[Groups(['progress:read'])]
    private \DateTimeImmutable $updatedAt;

    public function __construct()
    {
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

    public function getUser(): ?User
    {
        return $this->user;
    }

    public function setUser(?User $user): static
    {
        $this->user = $user;

        return $this;
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

    public function getManga(): ?Manga
    {
        return $this->manga;
    }

    public function setManga(?Manga $manga): static
    {
        $this->manga = $manga;

        return $this;
    }

    public function getCurrentEpisode(): ?int
    {
        return $this->currentEpisode;
    }

    public function setCurrentEpisode(?int $currentEpisode): static
    {
        $this->currentEpisode = $currentEpisode;

        return $this;
    }

    public function getCurrentChapter(): ?string
    {
        return $this->currentChapter;
    }

    public function setCurrentChapter(?string $currentChapter): static
    {
        $this->currentChapter = $currentChapter;

        return $this;
    }

    public function getStatus(): ProgressStatus
    {
        return $this->status;
    }

    public function setStatus(ProgressStatus $status): static
    {
        $this->status = $status;

        return $this;
    }

    public function getScore(): ?int
    {
        return $this->score;
    }

    public function setScore(?int $score): static
    {
        $this->score = $score;

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
}
