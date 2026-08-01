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
use App\Repository\FavoriteRepository;
use App\Validator\ExactlyOneMediaTarget;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Bridge\Doctrine\Validator\Constraints\UniqueEntity;
use Symfony\Component\Serializer\Attribute\Groups;
use Symfony\Component\Validator\Constraints as Assert;

/**
 * Mise en favori d'un anime OU d'un manga par un utilisateur.
 */
#[ORM\Entity(repositoryClass: FavoriteRepository::class)]
#[ORM\Table(name: 'favorite')]
#[ORM\UniqueConstraint(name: 'uniq_favorite_user_anime', columns: ['user_id', 'anime_id'])]
#[ORM\UniqueConstraint(name: 'uniq_favorite_user_manga', columns: ['user_id', 'manga_id'])]
#[ExactlyOneMediaTarget]
// Un même utilisateur ne met une œuvre en favori qu'une fois. Sans ces
// contraintes, le doublon n'était intercepté que par l'index unique en base,
// qui remonte en HTTP 500 avec le SQL en clair au lieu d'un 422 explicite.
// `ignoreNull` (actif par défaut) neutralise la règle côté manga quand c'est
// un favori d'anime, et inversement.
#[UniqueEntity(fields: ['user', 'anime'], message: 'Cet anime est déjà dans vos favoris.')]
#[UniqueEntity(fields: ['user', 'manga'], message: 'Ce manga est déjà dans vos favoris.')]
#[ApiResource(
    shortName: 'Favorite',
    description: 'Favori d\'un utilisateur, ciblant soit un anime, soit un manga.',
    operations: [
        new GetCollection(security: "is_granted('ROLE_USER')"),
        new Get(
            normalizationContext: ['groups' => ['favorite:read', 'favorite:item:read']],
            security: "is_granted('ROLE_USER') and object.getUser() === user", securityMessage: 'Cette ressource appartient à un autre utilisateur.',
        ),
        new Post(security: "is_granted('ROLE_USER')"),
        new Patch(security: "is_granted('ROLE_USER') and object.getUser() === user", securityMessage: 'Cette ressource appartient à un autre utilisateur.'),
        new Delete(security: "is_granted('ROLE_USER') and object.getUser() === user", securityMessage: 'Cette ressource appartient à un autre utilisateur.'),
    ],
    normalizationContext: ['groups' => ['favorite:read']],
    denormalizationContext: ['groups' => ['favorite:write']],
    order: ['createdAt' => 'DESC'],
)]
#[ApiFilter(SearchFilter::class, properties: ['user' => 'exact', 'anime' => 'exact', 'manga' => 'exact'])]
#[ApiFilter(ExistsFilter::class, properties: ['anime', 'manga'])]
#[ApiFilter(OrderFilter::class, properties: ['createdAt'])]
class Favorite implements OwnedByUser
{
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column]
    #[Groups(['favorite:read'])]
    private ?int $id = null;

    /**
     * Propriétaire de la ressource. Volontairement sans `Assert\NotNull` : il est
     * imposé par {@see \App\State\UserOwnedProcessor} à partir du jeton, APRÈS la
     * validation. Le rendre obligatoire ici obligerait le client à envoyer une valeur
     * de toute façon écrasée, et lui renverrait un 422 déroutant s'il l'omet. La
     * colonne reste NOT NULL en base : l'intégrité est garantie là où il faut.
     */
    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    #[Groups(['favorite:read', 'favorite:write'])]
    private ?User $user = null;

    #[ORM\ManyToOne(targetEntity: Anime::class)]
    #[ORM\JoinColumn(nullable: true, onDelete: 'CASCADE')]
    #[Groups(['favorite:read', 'favorite:write'])]
    private ?Anime $anime = null;

    #[ORM\ManyToOne(targetEntity: Manga::class)]
    #[ORM\JoinColumn(nullable: true, onDelete: 'CASCADE')]
    #[Groups(['favorite:read', 'favorite:write'])]
    private ?Manga $manga = null;

    #[ORM\Column(type: 'datetime_immutable')]
    #[Groups(['favorite:read'])]
    private \DateTimeImmutable $createdAt;

    public function __construct()
    {
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
