<?php

declare(strict_types=1);

namespace App\Repository;

use App\Entity\PasswordResetToken;
use App\Entity\User;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;

/**
 * @extends ServiceEntityRepository<PasswordResetToken>
 */
class PasswordResetTokenRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, PasswordResetToken::class);
    }

    public function findOneByHash(string $tokenHash): ?PasswordResetToken
    {
        return $this->findOneBy(['tokenHash' => $tokenHash]);
    }

    /**
     * Brûle tous les jetons encore vivants d'un compte.
     *
     * Appelé à chaque demande (une seule réinitialisation en vol à la fois), après
     * usage, et à tout changement de mot de passe. Ce dernier cas est le moins
     * évident et le plus important : sans lui, un lien demandé avant le changement
     * resterait valide APRÈS, et permettrait de reprendre la main sur un compte dont
     * le propriétaire vient justement de sécuriser l'accès.
     */
    public function invalidateAllFor(User $user, \DateTimeImmutable $now): void
    {
        $this->createQueryBuilder('t')
            ->update()
            ->set('t.usedAt', ':now')
            ->where('t.user = :user')
            ->andWhere('t.usedAt IS NULL')
            ->setParameter('now', $now)
            ->setParameter('user', $user)
            ->getQuery()
            ->execute();
    }

    /**
     * Purge les jetons dont la fenêtre est close depuis un moment.
     *
     * La table n'a aucune raison de grossir indéfiniment ; les lignes expirées ne
     * servent plus à rien puisqu'elles ne peuvent plus être consommées.
     */
    public function purgeExpiredBefore(\DateTimeImmutable $threshold): int
    {
        return (int) $this->createQueryBuilder('t')
            ->delete()
            ->where('t.expiresAt < :threshold')
            ->setParameter('threshold', $threshold)
            ->getQuery()
            ->execute();
    }
}
