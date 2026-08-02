<?php

declare(strict_types=1);

namespace App\Repository;

use App\Entity\User;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;
use Symfony\Component\Security\Core\Exception\UnsupportedUserException;
use Symfony\Component\Security\Core\User\PasswordAuthenticatedUserInterface;
use Symfony\Component\Security\Core\User\PasswordUpgraderInterface;

/**
 * @extends ServiceEntityRepository<User>
 *
 * @implements PasswordUpgraderInterface<User>
 */
class UserRepository extends ServiceEntityRepository implements PasswordUpgraderInterface
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, User::class);
    }

    /**
     * Ré-encode le mot de passe d'un utilisateur si l'algorithme a changé.
     */
    public function upgradePassword(PasswordAuthenticatedUserInterface $user, string $newHashedPassword): void
    {
        if (!$user instanceof User) {
            throw new UnsupportedUserException(\sprintf('Instances of "%s" are not supported.', $user::class));
        }

        $user->setPassword($newHashedPassword);
        $this->getEntityManager()->persist($user);
        $this->getEntityManager()->flush();
    }

    /**
     * Comptes administrateurs, destinataires des notifications d'exploitation.
     *
     * `roles` est une colonne JSON : plutôt qu'un opérateur `@>` propre à Postgres,
     * on filtre sur sa représentation textuelle. C'est moins élégant mais portable,
     * et le nombre de comptes reste sans commune mesure avec le coût d'un index.
     *
     * @return list<User>
     */
    public function findAdmins(): array
    {
        /** @var list<User> $users */
        $users = $this->createQueryBuilder('u')
            ->andWhere('CAST(u.roles AS text) LIKE :role')
            ->setParameter('role', '%ROLE_ADMIN%')
            ->orderBy('u.id', 'ASC')
            ->getQuery()
            ->getResult();

        return $users;
    }

    /**
     * Utilisateurs qui suivent un anime, c'est-à-dire qui l'ont mis en favori **ou**
     * qui ont une progression dessus. Les deux signaux comptent : on peut suivre une
     * série sans l'avoir marquée en favori.
     *
     * @return list<User>
     */
    public function findFollowersOfAnime(int $animeId): array
    {
        /** @var list<User> $users */
        $users = $this->createQueryBuilder('u')
            ->andWhere(
                'EXISTS (SELECT 1 FROM App\Entity\Favorite f WHERE f.user = u AND f.anime = :anime)'
                .' OR EXISTS (SELECT 1 FROM App\Entity\Progress p WHERE p.user = u AND p.anime = :anime)',
            )
            ->setParameter('anime', $animeId)
            ->orderBy('u.id', 'ASC')
            ->getQuery()
            ->getResult();

        return $users;
    }
}
