<?php

declare(strict_types=1);

namespace App\Entity;

use ApiPlatform\Doctrine\Orm\Filter\OrderFilter;
use ApiPlatform\Doctrine\Orm\Filter\SearchFilter;
use ApiPlatform\Metadata\ApiFilter;
use ApiPlatform\Metadata\ApiProperty;
use ApiPlatform\Metadata\ApiResource;
use ApiPlatform\Metadata\Delete;
use ApiPlatform\Metadata\Get;
use ApiPlatform\Metadata\GetCollection;
use ApiPlatform\Metadata\Patch;
use ApiPlatform\Metadata\Post;
use ApiPlatform\Metadata\Put;
use ApiPlatform\OpenApi\Model;
use App\Repository\UserRepository;
use App\State\MeProvider;
use App\State\UserPasswordHasherProcessor;
use App\Validator\CurrentPasswordRequired;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Bridge\Doctrine\Validator\Constraints\UniqueEntity;
use Symfony\Component\Security\Core\User\PasswordAuthenticatedUserInterface;
use Symfony\Component\Security\Core\User\UserInterface;
use Symfony\Component\Serializer\Attribute\Groups;
use Symfony\Component\Validator\Constraints as Assert;

/**
 * Utilisateur de la plateforme.
 *
 * L'inscription se fait par `POST /api/register` : le mot de passe en clair est haché
 * par {@see UserPasswordHasherProcessor}, `password` n'est jamais sérialisé et les
 * rôles ne sont pas attribuables depuis la requête.
 *
 * Le listing complet est réservé aux administrateurs (il exposerait tous les e-mails) ;
 * un utilisateur connecté récupère sa propre ressource via `GET /api/me`.
 */
#[ORM\Entity(repositoryClass: UserRepository::class)]
#[ORM\Table(name: '"user"')]
#[ORM\UniqueConstraint(name: 'uniq_user_email', columns: ['email'])]
#[ORM\UniqueConstraint(name: 'uniq_user_username', columns: ['username'])]
#[UniqueEntity(fields: ['email'], message: 'Un compte existe déjà avec cette adresse e-mail.')]
#[UniqueEntity(fields: ['username'], message: 'Ce nom d\'utilisateur est déjà pris.')]
#[CurrentPasswordRequired]
#[ApiResource(
    shortName: 'User',
    description: 'Compte utilisateur.',
    operations: [
        new GetCollection(
            security: "is_granted('ROLE_ADMIN')",
            securityMessage: 'Le listing des comptes est réservé aux administrateurs.',
        ),
        new Get(
            normalizationContext: ['groups' => ['user:read', 'user:item:read']],
            security: "is_granted('ROLE_ADMIN') or object === user",
        ),
        // Profil courant. Déclaré avant les autres routes item pour que `/api/me`
        // ne soit pas capté par le motif `/api/users/{id}`.
        new Get(
            uriTemplate: '/me',
            normalizationContext: [
                'groups' => ['user:read', 'user:item:read'],
                // `@id` doit être l'IRI CANONIQUE du compte, pas celle de l'opération.
                // API Platform génère `@id` à partir de l'opération en cours : sans
                // cela, `/api/me` se décrivait lui-même par `"@id": "/api/me"`. Or le
                // frontend récupère précisément cette valeur pour la renvoyer en
                // `Favorite.user` ou `Progress.user` — et `/api/me` n'y est pas une
                // référence valide. On force donc l'opération item de User.
                'item_uri_template' => '/users/{id}',
            ],
            security: "is_granted('ROLE_USER')",
            provider: MeProvider::class,
            read: true,
            description: 'Retourne le compte associé au jeton présenté.',
            openapi: new Model\Operation(summary: 'Profil de l\'utilisateur authentifié.'),
        ),
        // Inscription publique.
        new Post(
            uriTemplate: '/register',
            validationContext: ['groups' => ['Default', 'user:register']],
            processor: UserPasswordHasherProcessor::class,
            description: 'Crée un compte. Le mot de passe est haché côté serveur.',
        ),
        // Alias historique de l'inscription, conservé pour ne pas casser le client
        // existant. À supprimer une fois le frontend basculé sur /api/register.
        new Post(
            validationContext: ['groups' => ['Default', 'user:register']],
            processor: UserPasswordHasherProcessor::class,
            deprecationReason: 'Utiliser POST /api/register.',
        ),
        new Put(
            security: "is_granted('ROLE_ADMIN') or object === user",
            processor: UserPasswordHasherProcessor::class,
        ),
        new Patch(
            security: "is_granted('ROLE_ADMIN') or object === user",
            processor: UserPasswordHasherProcessor::class,
        ),
        new Delete(security: "is_granted('ROLE_ADMIN') or object === user"),
    ],
    normalizationContext: ['groups' => ['user:read']],
    denormalizationContext: ['groups' => ['user:write']],
    order: ['username' => 'ASC'],
)]
#[ApiFilter(SearchFilter::class, properties: ['username' => 'ipartial', 'email' => 'exact'])]
#[ApiFilter(OrderFilter::class, properties: ['username', 'createdAt'])]
class User implements UserInterface, PasswordAuthenticatedUserInterface
{
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column]
    #[Groups(['user:read', 'comment:read', 'favorite:read', 'progress:read', 'notification:read', 'recommendation:read'])]
    private ?int $id = null;

    #[ORM\Column(length: 180, unique: true)]
    #[Assert\NotBlank]
    #[Assert\Email]
    #[Assert\Length(max: 180)]
    #[Groups(['user:read', 'user:write'])]
    private string $email = '';

    #[ORM\Column(length: 50, unique: true)]
    #[Assert\NotBlank]
    #[Assert\Length(min: 3, max: 50)]
    #[Groups(['user:read', 'user:write', 'comment:read', 'favorite:read', 'progress:read', 'recommendation:read'])]
    private string $username = '';

    /**
     * Rôles additionnels. Volontairement absent du groupe `user:write` : les rôles ne
     * sont pas attribuables via l'API, sans quoi n'importe qui s'inscrirait
     * administrateur. La promotion se fait en console (`app:user:create --admin`).
     *
     * @var list<string>
     */
    #[ORM\Column(type: 'json')]
    #[Groups(['user:read'])]
    private array $roles = [];

    /**
     * Mot de passe haché. Jamais exposé par l'API.
     */
    #[ORM\Column(length: 255)]
    #[ApiProperty(readable: false, writable: false)]
    private string $password = '';

    /**
     * Mot de passe en clair, non persisté : haché par {@see UserPasswordHasherProcessor}
     * puis effacé. Obligatoire à l'inscription, facultatif sur une mise à jour
     * (un PATCH qui ne le fournit pas laisse le mot de passe inchangé).
     */
    #[Assert\NotBlank(groups: ['user:register'])]
    #[Assert\Length(min: 8, max: 4096)]
    #[ApiProperty(description: 'Mot de passe en clair (écriture seule).')]
    #[Groups(['user:write'])]
    private ?string $plainPassword = null;

    /**
     * Mot de passe courant, exigé pour en changer. Ni persisté ni sérialisé en
     * lecture. Voir {@see \App\Validator\CurrentPasswordRequired} : sans cette
     * preuve, un JWT volé permettait de changer le mot de passe et de verrouiller le
     * propriétaire hors de son compte.
     */
    #[ApiProperty(description: 'Mot de passe actuel, obligatoire pour modifier `plainPassword` sur son propre compte (écriture seule).')]
    #[Groups(['user:write'])]
    private ?string $currentPassword = null;

    #[ORM\Column(type: 'datetime_immutable')]
    #[Groups(['user:read'])]
    private \DateTimeImmutable $createdAt;

    public function __construct()
    {
        $this->createdAt = new \DateTimeImmutable();
    }

    public function getId(): ?int
    {
        return $this->id;
    }

    public function getEmail(): string
    {
        return $this->email;
    }

    public function setEmail(string $email): static
    {
        $this->email = $email;

        return $this;
    }

    public function getUsername(): string
    {
        return $this->username;
    }

    public function setUsername(string $username): static
    {
        $this->username = $username;

        return $this;
    }

    /**
     * Identifiant unique utilisé par le système de sécurité Symfony.
     */
    public function getUserIdentifier(): string
    {
        return $this->email;
    }

    /**
     * @return list<string>
     */
    public function getRoles(): array
    {
        $roles = $this->roles;
        $roles[] = 'ROLE_USER';

        return array_values(array_unique($roles));
    }

    /**
     * @param list<string> $roles
     */
    public function setRoles(array $roles): static
    {
        $this->roles = $roles;

        return $this;
    }

    public function getPassword(): string
    {
        return $this->password;
    }

    public function setPassword(string $password): static
    {
        $this->password = $password;

        return $this;
    }

    public function getPlainPassword(): ?string
    {
        return $this->plainPassword;
    }

    public function setPlainPassword(?string $plainPassword): static
    {
        $this->plainPassword = $plainPassword;

        return $this;
    }

    public function getCurrentPassword(): ?string
    {
        return $this->currentPassword;
    }

    public function setCurrentPassword(?string $currentPassword): static
    {
        $this->currentPassword = $currentPassword;

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

    /**
     * Efface les données sensibles temporaires.
     */
    public function eraseCredentials(): void
    {
        $this->plainPassword = null;
        $this->currentPassword = null;
    }

    public function __toString(): string
    {
        return $this->username;
    }
}
