<?php

declare(strict_types=1);

namespace App\State;

use ApiPlatform\Metadata\Operation;
use ApiPlatform\State\ProviderInterface;
use App\Entity\User;
use Symfony\Bundle\SecurityBundle\Security;

/**
 * Fournit `GET /api/me` : la ressource de l'utilisateur porteur du jeton.
 *
 * Indispensable côté client : le listing `/api/users` est réservé aux
 * administrateurs, or le frontend a besoin de l'IRI de son propre compte pour
 * construire les payloads d'écriture (`Favorite.user`, `Progress.user`, ...).
 *
 * @implements ProviderInterface<User>
 */
final readonly class MeProvider implements ProviderInterface
{
    public function __construct(private Security $security)
    {
    }

    public function provide(Operation $operation, array $uriVariables = [], array $context = []): ?User
    {
        $user = $this->security->getUser();

        return $user instanceof User ? $user : null;
    }
}
