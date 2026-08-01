<?php

declare(strict_types=1);

namespace App\Entity;

use ApiPlatform\Doctrine\Orm\Filter\ExistsFilter;
use ApiPlatform\Doctrine\Orm\Filter\OrderFilter;
use ApiPlatform\Doctrine\Orm\Filter\SearchFilter;
use ApiPlatform\Metadata\ApiFilter;
use ApiPlatform\Metadata\ApiResource;
use ApiPlatform\Metadata\Delete;
use ApiPlatform\Metadata\Get;
use ApiPlatform\Metadata\GetCollection;
use ApiPlatform\Metadata\Patch;
use ApiPlatform\Metadata\Post;
use App\Repository\CommentRepository;
use App\Validator\ExactlyOneMediaTarget;
use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Serializer\Attribute\Groups;
use Symfony\Component\Validator\Constraints as Assert;

/**
 * Commentaire posté sur un anime OU un manga, éventuellement en réponse à un autre commentaire.
 */
#[ORM\Entity(repositoryClass: CommentRepository::class)]
#[ORM\Table(name: 'comment')]
#[ORM\Index(name: 'idx_comment_anime', columns: ['anime_id'])]
#[ORM\Index(name: 'idx_comment_manga', columns: ['manga_id'])]
#[ExactlyOneMediaTarget]
#[ApiResource(
    shortName: 'Comment',
    description: 'Commentaire utilisateur (fil de discussion à un niveau de réponse).',
    operations: [
        new GetCollection(),
        new Get(normalizationContext: ['groups' => ['comment:read', 'comment:item:read']]),
        new Post(security: "is_granted('ROLE_USER')"),
        new Patch(security: "is_granted('ROLE_USER') and object.getUser() === user", securityMessage: 'Seul l\'auteur peut modifier son commentaire.'),
        new Delete(
            security: "is_granted('ROLE_ADMIN') or (is_granted('ROLE_USER') and object.getUser() === user)",
            securityMessage: 'Seuls l\'auteur et un administrateur peuvent supprimer ce commentaire.',
        ),
    ],
    normalizationContext: ['groups' => ['comment:read']],
    denormalizationContext: ['groups' => ['comment:write']],
    order: ['createdAt' => 'DESC'],
)]
#[ApiFilter(SearchFilter::class, properties: ['user' => 'exact', 'anime' => 'exact', 'manga' => 'exact', 'parent' => 'exact', 'content' => 'ipartial'])]
#[ApiFilter(ExistsFilter::class, properties: ['parent', 'anime', 'manga'])]
#[ApiFilter(OrderFilter::class, properties: ['createdAt'])]
class Comment implements OwnedByUser
{
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column]
    #[Groups(['comment:read'])]
    private ?int $id = null;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    #[Assert\NotNull]
    #[Groups(['comment:read', 'comment:write'])]
    private ?User $user = null;

    #[ORM\Column(type: 'text')]
    #[Assert\NotBlank]
    #[Assert\Length(min: 1, max: 5000)]
    #[Groups(['comment:read', 'comment:write'])]
    private string $content = '';

    #[ORM\ManyToOne(targetEntity: Anime::class)]
    #[ORM\JoinColumn(nullable: true, onDelete: 'CASCADE')]
    #[Groups(['comment:read', 'comment:write'])]
    private ?Anime $anime = null;

    #[ORM\ManyToOne(targetEntity: Manga::class)]
    #[ORM\JoinColumn(nullable: true, onDelete: 'CASCADE')]
    #[Groups(['comment:read', 'comment:write'])]
    private ?Manga $manga = null;

    /**
     * Commentaire parent lorsque celui-ci est une réponse.
     */
    #[ORM\ManyToOne(targetEntity: self::class, inversedBy: 'replies')]
    #[ORM\JoinColumn(nullable: true, onDelete: 'CASCADE')]
    #[Groups(['comment:read', 'comment:write'])]
    private ?self $parent = null;

    /** @var Collection<int, Comment> */
    #[ORM\OneToMany(targetEntity: self::class, mappedBy: 'parent', cascade: ['remove'])]
    #[ORM\OrderBy(['createdAt' => 'ASC'])]
    #[Groups(['comment:item:read'])]
    private Collection $replies;

    #[ORM\Column(type: 'datetime_immutable')]
    #[Groups(['comment:read'])]
    private \DateTimeImmutable $createdAt;

    public function __construct()
    {
        $this->replies = new ArrayCollection();
        $this->createdAt = new \DateTimeImmutable();
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

    public function getContent(): string
    {
        return $this->content;
    }

    public function setContent(string $content): static
    {
        $this->content = $content;

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

    public function getParent(): ?self
    {
        return $this->parent;
    }

    public function setParent(?self $parent): static
    {
        $this->parent = $parent;

        return $this;
    }

    /** @return Collection<int, Comment> */
    public function getReplies(): Collection
    {
        return $this->replies;
    }

    public function addReply(self $reply): static
    {
        if (!$this->replies->contains($reply)) {
            $this->replies->add($reply);
            $reply->setParent($this);
        }

        return $this;
    }

    public function removeReply(self $reply): static
    {
        if ($this->replies->removeElement($reply) && $reply->getParent() === $this) {
            $reply->setParent(null);
        }

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
}
