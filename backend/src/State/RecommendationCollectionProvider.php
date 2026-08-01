<?php

declare(strict_types=1);

namespace App\State;

use ApiPlatform\Metadata\Operation;
use ApiPlatform\State\ProviderInterface;
use App\Entity\User;
use App\Service\Recommendation\RecommendationEngine;
use Symfony\Bundle\SecurityBundle\Security;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Alimente `GET /api/recommendations` pour l'utilisateur courant.
 *
 * Les recommandations sont recalculées à la volée quand elles sont absentes,
 * périmées, ou plus anciennes que le dernier favori ajouté — puis servies depuis la
 * base par le provider Doctrine normal. Déléguer plutôt que retourner un tableau
 * garde la pagination, les filtres et le cloisonnement par utilisateur
 * ({@see \App\Doctrine\Extension\CurrentUserExtension}) exactement tels quels, et
 * les ressources renvoyées ont de vrais IRI.
 *
 * @implements ProviderInterface<object>
 */
final readonly class RecommendationCollectionProvider implements ProviderInterface
{
    public function __construct(
        #[Autowire(service: 'api_platform.doctrine.orm.state.collection_provider')]
        private ProviderInterface $collectionProvider,
        private RecommendationEngine $engine,
        private Security $security,
    ) {
    }

    public function provide(Operation $operation, array $uriVariables = [], array $context = []): iterable
    {
        $user = $this->security->getUser();

        if ($user instanceof User) {
            $this->engine->refreshIfStale($user);
        }

        /** @var iterable<object> $result */
        $result = $this->collectionProvider->provide($operation, $uriVariables, $context);

        return $result;
    }
}
