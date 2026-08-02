<?php

declare(strict_types=1);

namespace App\State;

use ApiPlatform\Metadata\Operation;
use ApiPlatform\State\ProviderInterface;
use App\ApiResource\MercureSubscription;
use App\Entity\User;
use App\Service\Notification\MercureSubscriptionFactory;
use Symfony\Bundle\SecurityBundle\Security;

/**
 * Fournit `GET /api/mercure/subscription`.
 *
 * Le topic n'est jamais lu depuis la requête : il est dérivé de l'utilisateur porteur
 * du jeton. Un client ne peut donc pas se faire délivrer un jeton d'abonnement pour le
 * topic de quelqu'un d'autre.
 *
 * @implements ProviderInterface<MercureSubscription>
 */
final readonly class MercureSubscriptionProvider implements ProviderInterface
{
    public function __construct(
        private Security $security,
        private MercureSubscriptionFactory $factory,
    ) {
    }

    public function provide(Operation $operation, array $uriVariables = [], array $context = []): ?MercureSubscription
    {
        $user = $this->security->getUser();

        return $user instanceof User ? $this->factory->forUser($user) : null;
    }
}
