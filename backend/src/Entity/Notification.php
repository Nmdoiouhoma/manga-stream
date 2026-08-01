<?php

declare(strict_types=1);

namespace App\Entity;

use ApiPlatform\Doctrine\Orm\Filter\BooleanFilter;
use ApiPlatform\Doctrine\Orm\Filter\OrderFilter;
use ApiPlatform\Doctrine\Orm\Filter\SearchFilter;
use ApiPlatform\Metadata\ApiFilter;
use ApiPlatform\Metadata\ApiResource;
use ApiPlatform\Metadata\Delete;
use ApiPlatform\Metadata\Get;
use ApiPlatform\Metadata\GetCollection;
use ApiPlatform\Metadata\Patch;
use ApiPlatform\Metadata\Post;
use App\Enum\NotificationType;
use App\Repository\NotificationRepository;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Serializer\Attribute\Groups;
use Symfony\Component\Validator\Constraints as Assert;

/**
 * Notification destinée à un utilisateur.
 *
 * `payload` est un objet JSON libre dont la forme dépend de `type`
 * (ex. NEW_EPISODE => {"animeId": 12, "episodeNumber": 5}).
 */
#[ORM\Entity(repositoryClass: NotificationRepository::class)]
#[ORM\Table(name: 'notification')]
#[ORM\Index(name: 'idx_notification_user_read', columns: ['user_id', 'is_read'])]
#[ApiResource(
    shortName: 'Notification',
    description: 'Notification utilisateur.',
    operations: [
        new GetCollection(security: "is_granted('ROLE_USER')"),
        new Get(
            normalizationContext: ['groups' => ['notification:read', 'notification:item:read']],
            security: "is_granted('ROLE_USER') and object.getUser() === user", securityMessage: 'Cette ressource appartient à un autre utilisateur.',
        ),
        new Post(security: "is_granted('ROLE_USER')"),
        new Patch(security: "is_granted('ROLE_USER') and object.getUser() === user", securityMessage: 'Cette ressource appartient à un autre utilisateur.'),
        new Delete(security: "is_granted('ROLE_USER') and object.getUser() === user", securityMessage: 'Cette ressource appartient à un autre utilisateur.'),
    ],
    normalizationContext: ['groups' => ['notification:read']],
    denormalizationContext: ['groups' => ['notification:write']],
    order: ['createdAt' => 'DESC'],
)]
#[ApiFilter(SearchFilter::class, properties: ['user' => 'exact', 'type' => 'exact'])]
#[ApiFilter(BooleanFilter::class, properties: ['isRead'])]
#[ApiFilter(OrderFilter::class, properties: ['createdAt'])]
class Notification implements OwnedByUser
{
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column]
    #[Groups(['notification:read'])]
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
    #[Groups(['notification:read', 'notification:write'])]
    private ?User $user = null;

    #[ORM\Column(type: 'string', length: 32, enumType: NotificationType::class)]
    #[Assert\NotNull]
    #[Groups(['notification:read', 'notification:write'])]
    private NotificationType $type = NotificationType::SYSTEM;

    /**
     * @var array<string, mixed>
     */
    #[ORM\Column(type: 'json')]
    #[Groups(['notification:read', 'notification:write'])]
    private array $payload = [];

    #[ORM\Column(type: 'boolean', options: ['default' => false])]
    #[Groups(['notification:read', 'notification:write'])]
    private bool $isRead = false;

    #[ORM\Column(type: 'datetime_immutable')]
    #[Groups(['notification:read'])]
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

    public function getType(): NotificationType
    {
        return $this->type;
    }

    public function setType(NotificationType $type): static
    {
        $this->type = $type;

        return $this;
    }

    /**
     * @return array<string, mixed>
     */
    public function getPayload(): array
    {
        return $this->payload;
    }

    /**
     * @param array<string, mixed> $payload
     */
    public function setPayload(array $payload): static
    {
        $this->payload = $payload;

        return $this;
    }

    public function isRead(): bool
    {
        return $this->isRead;
    }

    public function setIsRead(bool $isRead): static
    {
        $this->isRead = $isRead;

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
