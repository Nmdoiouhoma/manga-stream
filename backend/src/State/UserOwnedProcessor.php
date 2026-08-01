<?php

declare(strict_types=1);

namespace App\State;

use ApiPlatform\Metadata\DeleteOperationInterface;
use ApiPlatform\Metadata\Operation;
use ApiPlatform\Metadata\Post;
use ApiPlatform\State\ProcessorInterface;
use App\Entity\OwnedByUser;
use App\Entity\User;
use Symfony\Bundle\SecurityBundle\Security;
use Symfony\Component\DependencyInjection\Attribute\AsDecorator;
use Symfony\Component\DependencyInjection\Attribute\AutowireDecorated;

/**
 * Force le propriétaire d'une ressource personnelle à la création.
 *
 * Sans cela, un utilisateur authentifié pourrait poster
 * `{"user": "/api/users/42", ...}` et créer un favori, une progression ou un
 * commentaire au nom de quelqu'un d'autre. Le champ `user` envoyé par le client est
 * donc systématiquement écrasé par l'utilisateur du jeton.
 *
 * Décore le processor de persistance Doctrine : s'applique à toutes les ressources
 * implémentant {@see OwnedByUser}, sans avoir à le déclarer opération par opération.
 */
#[AsDecorator('api_platform.doctrine.orm.state.persist_processor')]
final readonly class UserOwnedProcessor implements ProcessorInterface
{
    public function __construct(
        #[AutowireDecorated]
        private ProcessorInterface $decorated,
        private Security $security,
    ) {
    }

    public function process(mixed $data, Operation $operation, array $uriVariables = [], array $context = []): mixed
    {
        if ($data instanceof OwnedByUser && $operation instanceof Post && !$operation instanceof DeleteOperationInterface) {
            $user = $this->security->getUser();
            if ($user instanceof User) {
                $data->setUser($user);
            }
        }

        return $this->decorated->process($data, $operation, $uriVariables, $context);
    }
}
