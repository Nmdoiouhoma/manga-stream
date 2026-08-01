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
use App\Repository\RecommendationRepository;
use App\State\RecommendationCollectionProvider;
use App\Validator\ExactlyOneMediaTarget;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Serializer\Attribute\Groups;
use Symfony\Component\Validator\Constraints as Assert;

/**
 * Recommandation générée pour un utilisateur.
 *
 * `GET /api/recommendations` déclenche au besoin un recalcul par
 * {@see \App\Service\Recommendation\RecommendationEngine} (recouvrement de genres
 * entre les favoris et le catalogue) et ne renvoie que les recommandations de
 * l'utilisateur courant. `reason` porte l'explication du rapprochement.
 */
#[ORM\Entity(repositoryClass: RecommendationRepository::class)]
#[ORM\Table(name: 'recommendation')]
#[ORM\Index(name: 'idx_recommendation_user_score', columns: ['user_id', 'score'])]
#[ExactlyOneMediaTarget]
#[ApiResource(
    shortName: 'Recommendation',
    description: 'Recommandation personnalisée (anime ou manga) pour un utilisateur.',
    operations: [
        new GetCollection(
            security: "is_granted('ROLE_USER')",
            provider: RecommendationCollectionProvider::class,
            description: 'Recommandations de l\'utilisateur courant, recalculées si elles sont périmées.',
        ),
        new Get(
            normalizationContext: ['groups' => ['recommendation:read', 'recommendation:item:read']],
            security: "is_granted('ROLE_USER') and object.getUser() === user", securityMessage: 'Cette ressource appartient à un autre utilisateur.',
        ),
        new Post(security: "is_granted('ROLE_USER')"),
        new Patch(security: "is_granted('ROLE_USER') and object.getUser() === user", securityMessage: 'Cette ressource appartient à un autre utilisateur.'),
        new Delete(security: "is_granted('ROLE_USER') and object.getUser() === user", securityMessage: 'Cette ressource appartient à un autre utilisateur.'),
    ],
    normalizationContext: ['groups' => ['recommendation:read']],
    denormalizationContext: ['groups' => ['recommendation:write']],
    order: ['score' => 'DESC'],
)]
#[ApiFilter(SearchFilter::class, properties: ['user' => 'exact', 'anime' => 'exact', 'manga' => 'exact'])]
#[ApiFilter(ExistsFilter::class, properties: ['anime', 'manga'])]
#[ApiFilter(RangeFilter::class, properties: ['score'])]
#[ApiFilter(OrderFilter::class, properties: ['score', 'generatedAt'])]
class Recommendation implements OwnedByUser
{
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column]
    #[Groups(['recommendation:read'])]
    private ?int $id = null;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    #[Assert\NotNull]
    #[Groups(['recommendation:read', 'recommendation:write'])]
    private ?User $user = null;

    #[ORM\ManyToOne(targetEntity: Anime::class)]
    #[ORM\JoinColumn(nullable: true, onDelete: 'CASCADE')]
    #[Groups(['recommendation:read', 'recommendation:write'])]
    private ?Anime $anime = null;

    #[ORM\ManyToOne(targetEntity: Manga::class)]
    #[ORM\JoinColumn(nullable: true, onDelete: 'CASCADE')]
    #[Groups(['recommendation:read', 'recommendation:write'])]
    private ?Manga $manga = null;

    /**
     * Score de pertinence normalisé entre 0 et 1.
     */
    #[ORM\Column(type: 'float')]
    #[Assert\NotNull]
    #[Assert\Range(min: 0, max: 1)]
    #[Groups(['recommendation:read', 'recommendation:write'])]
    private float $score = 0.0;

    /**
     * Explication de la recommandation, structurée en JSON
     * (ex. {"strategy": "genre_overlap", "genres": ["Action"], "seed": 42}).
     *
     * @var array<string, mixed>
     */
    #[ORM\Column(type: 'json')]
    #[Groups(['recommendation:read', 'recommendation:write'])]
    private array $reason = [];

    #[ORM\Column(type: 'datetime_immutable')]
    #[Groups(['recommendation:read'])]
    private \DateTimeImmutable $generatedAt;

    public function __construct()
    {
        $this->generatedAt = new \DateTimeImmutable();
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

    public function getScore(): float
    {
        return $this->score;
    }

    public function setScore(float $score): static
    {
        $this->score = $score;

        return $this;
    }

    /**
     * @return array<string, mixed>
     */
    public function getReason(): array
    {
        return $this->reason;
    }

    /**
     * @param array<string, mixed> $reason
     */
    public function setReason(array $reason): static
    {
        $this->reason = $reason;

        return $this;
    }

    public function getGeneratedAt(): \DateTimeImmutable
    {
        return $this->generatedAt;
    }

    public function setGeneratedAt(\DateTimeImmutable $generatedAt): static
    {
        $this->generatedAt = $generatedAt;

        return $this;
    }
}
