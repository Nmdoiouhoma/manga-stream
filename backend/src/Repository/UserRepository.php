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
     * Le filtrage se fait en PHP, et c'est délibéré. `roles` est une colonne `json` :
     * `LIKE` dessus échoue sous Postgres (« operator does not exist: json ~~ unknown »),
     * DQL ne connaît pas `CAST`, et l'opérateur de confinement `@>` n'existe que sous
     * Postgres — le brancher ici ferait échouer la suite de tests le jour où elle
     * tournerait sur autre chose. On lit donc `(id, roles)`, deux colonnes étroites,
     * puis on charge les seules entités retenues. La requête est appelée une fois par
     * campagne d'import, jamais dans un chemin de requête HTTP.
     *
     * @return list<User>
     */
    public function findAdmins(): array
    {
        /** @var list<array{id: int, roles: list<string>}> $rows */
        $rows = $this->createQueryBuilder('u')
            ->select('u.id', 'u.roles')
            ->getQuery()
            ->getArrayResult();

        $ids = [];
        foreach ($rows as $row) {
            if (\in_array('ROLE_ADMIN', $row['roles'], true)) {
                $ids[] = $row['id'];
            }
        }

        if ([] === $ids) {
            return [];
        }

        /** @var list<User> $users */
        $users = $this->createQueryBuilder('u')
            ->andWhere('u.id IN (:ids)')
            ->setParameter('ids', $ids)
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
