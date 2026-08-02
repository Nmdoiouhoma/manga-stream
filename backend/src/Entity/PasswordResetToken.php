<?php

declare(strict_types=1);

namespace App\Entity;

use App\Repository\PasswordResetTokenRepository;
use Doctrine\ORM\Mapping as ORM;

/**
 * Jeton de réinitialisation de mot de passe, à usage unique.
 *
 * Volontairement PAS une ressource API : rien de ce qui est ici ne doit être
 * listable, lisible ou modifiable depuis l'extérieur. Les deux seuls points d'entrée
 * sont `POST /api/password/forgot` et `POST /api/password/reset`.
 *
 * Le jeton n'est JAMAIS stocké en clair. La colonne porte son empreinte SHA-256, et
 * la valeur brute n'existe que dans l'e-mail envoyé à l'utilisateur. Une base volée
 * ne donne donc aucun jeton utilisable — c'est le même raisonnement que pour un mot
 * de passe, et la même raison : la table de réinitialisation est un passe-partout sur
 * tous les comptes du site.
 *
 * SHA-256 nu et non bcrypt/argon : contrairement à un mot de passe, ce jeton est
 * 256 bits d'aléa cryptographique. Il n'y a rien à deviner, donc rien à ralentir ;
 * un hachage lent coûterait ici du temps de calcul sans rien apporter, et empêcherait
 * la recherche par index à laquelle sert précisément cette colonne.
 */
#[ORM\Entity(repositoryClass: PasswordResetTokenRepository::class)]
#[ORM\Table(name: 'password_reset_token')]
#[ORM\UniqueConstraint(name: 'uniq_password_reset_token_hash', columns: ['token_hash'])]
#[ORM\Index(name: 'idx_password_reset_token_user', columns: ['user_id'])]
class PasswordResetToken
{
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column]
    private ?int $id = null;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private User $user;

    /**
     * Empreinte hexadécimale SHA-256 du jeton remis à l'utilisateur.
     */
    #[ORM\Column(length: 64, unique: true)]
    private string $tokenHash;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $expiresAt;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $createdAt;

    /**
     * Horodatage de consommation. Non nul = jeton brûlé, définitivement inutilisable.
     * On conserve la ligne au lieu de la supprimer : une seconde tentative avec le
     * même lien est ainsi distinguable d'un lien inventé, ce qui rend le journal
     * exploitable en cas d'incident.
     */
    #[ORM\Column(type: 'datetime_immutable', nullable: true)]
    private ?\DateTimeImmutable $usedAt = null;

    public function __construct(User $user, string $tokenHash, \DateTimeImmutable $expiresAt)
    {
        $this->user = $user;
        $this->tokenHash = $tokenHash;
        $this->expiresAt = $expiresAt;
        $this->createdAt = new \DateTimeImmutable();
    }

    public function getId(): ?int
    {
        return $this->id;
    }

    public function getUser(): User
    {
        return $this->user;
    }

    public function getTokenHash(): string
    {
        return $this->tokenHash;
    }

    public function getExpiresAt(): \DateTimeImmutable
    {
        return $this->expiresAt;
    }

    public function getCreatedAt(): \DateTimeImmutable
    {
        return $this->createdAt;
    }

    public function getUsedAt(): ?\DateTimeImmutable
    {
        return $this->usedAt;
    }

    public function isUsable(\DateTimeImmutable $now): bool
    {
        return null === $this->usedAt && $this->expiresAt > $now;
    }

    public function markUsed(\DateTimeImmutable $now): void
    {
        $this->usedAt = $now;
    }
}
