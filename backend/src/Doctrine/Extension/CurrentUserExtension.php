<?php

declare(strict_types=1);

namespace App\Doctrine\Extension;

use ApiPlatform\Doctrine\Orm\Extension\QueryCollectionExtensionInterface;
use ApiPlatform\Doctrine\Orm\Extension\QueryItemExtensionInterface;
use ApiPlatform\Doctrine\Orm\Util\QueryNameGeneratorInterface;
use ApiPlatform\Metadata\Operation;
use App\Entity\Favorite;
use App\Entity\Notification;
use App\Entity\Progress;
use App\Entity\Recommendation;
use App\Entity\User;
use Doctrine\ORM\QueryBuilder;
use Symfony\Bundle\SecurityBundle\Security;

/**
 * Restreint les ressources personnelles à leur propriétaire, au niveau SQL.
 *
 * C'est la garantie de fond : un `is_granted('ROLE_USER')` sur l'opération autoriserait
 * n'importe quel compte à lister les favoris de tout le monde. Ici la clause
 * `WHERE user_id = :current_user` est ajoutée à la requête elle-même, aussi bien pour
 * les collections que pour les items — un item appartenant à autrui renvoie donc 404,
 * sans fuite d'information.
 *
 * Les administrateurs ne sont pas filtrés (supervision, support).
 */
final readonly class CurrentUserExtension implements QueryCollectionExtensionInterface, QueryItemExtensionInterface
{
    /**
     * Ressources strictement personnelles. `Comment` en est volontairement absent :
     * les commentaires sont publics en lecture.
     *
     * @var list<class-string>
     */
    private const RESTRICTED_RESOURCES = [
        Favorite::class,
        Progress::class,
        Notification::class,
        Recommendation::class,
    ];

    public function __construct(private Security $security)
    {
    }

    public function applyToCollection(
        QueryBuilder $queryBuilder,
        QueryNameGeneratorInterface $queryNameGenerator,
        string $resourceClass,
        ?Operation $operation = null,
        array $context = [],
    ): void {
        $this->restrict($queryBuilder, $resourceClass);
    }

    public function applyToItem(
        QueryBuilder $queryBuilder,
        QueryNameGeneratorInterface $queryNameGenerator,
        string $resourceClass,
        array $identifiers,
        ?Operation $operation = null,
        array $context = [],
    ): void {
        $this->restrict($queryBuilder, $resourceClass);
    }

    private function restrict(QueryBuilder $queryBuilder, string $resourceClass): void
    {
        if (!\in_array($resourceClass, self::RESTRICTED_RESOURCES, true)) {
            return;
        }

        if ($this->security->isGranted('ROLE_ADMIN')) {
            return;
        }

        $user = $this->security->getUser();
        $alias = $queryBuilder->getRootAliases()[0];

        if (!$user instanceof User) {
            // Non authentifié : aucune ligne. L'attribut `security` de l'opération
            // renvoie de toute façon un 401, cette clause est une ceinture de plus.
            $queryBuilder->andWhere('1 = 0');

            return;
        }

        $queryBuilder
            ->andWhere(\sprintf('%s.user = :current_user', $alias))
            ->setParameter('current_user', $user);
    }
}
