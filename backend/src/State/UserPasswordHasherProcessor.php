<?php

declare(strict_types=1);

namespace App\State;

use ApiPlatform\Metadata\Operation;
use ApiPlatform\Metadata\Post;
use ApiPlatform\State\ProcessorInterface;
use App\Entity\User;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * Hache `plainPassword` avant persistance et empêche l'escalade de privilèges.
 *
 * `plainPassword` est exposé en écriture seule sur l'entité mais n'était jusqu'ici
 * jamais transformé : les comptes se créaient avec un mot de passe vide. Ce processor
 * est branché sur les opérations d'écriture de `User`.
 *
 * Il force également `ROLE_USER` à l'inscription : sans cela, un `POST` contenant
 * `{"roles": ["ROLE_ADMIN"]}` suffirait à se donner les pleins pouvoirs.
 */
final readonly class UserPasswordHasherProcessor implements ProcessorInterface
{
    public function __construct(
        #[Autowire(service: 'api_platform.doctrine.orm.state.persist_processor')]
        private ProcessorInterface $persistProcessor,
        private UserPasswordHasherInterface $passwordHasher,
    ) {
    }

    public function process(mixed $data, Operation $operation, array $uriVariables = [], array $context = []): mixed
    {
        if (!$data instanceof User) {
            return $this->persistProcessor->process($data, $operation, $uriVariables, $context);
        }

        if ($operation instanceof Post) {
            // L'attribution de rôles ne passe jamais par l'inscription publique.
            $data->setRoles([]);
        }

        $plainPassword = $data->getPlainPassword();
        if (null !== $plainPassword && '' !== $plainPassword) {
            $data->setPassword($this->passwordHasher->hashPassword($data, $plainPassword));
            $data->eraseCredentials();
        }

        return $this->persistProcessor->process($data, $operation, $uriVariables, $context);
    }
}
