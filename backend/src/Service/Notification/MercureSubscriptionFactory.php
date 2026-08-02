<?php

declare(strict_types=1);

namespace App\Service\Notification;

use App\ApiResource\MercureSubscription;
use App\Entity\User;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\Mercure\HubInterface;

/**
 * Émet le **JWT abonné** que le frontend présente au hub Mercure.
 *
 * Le jeton ne porte qu'une chose : `mercure.subscribe` limité au seul topic personnel
 * du porteur. Il n'accorde **aucun droit de publication** (`mercure.publish` vide) —
 * seul le backend publie.
 *
 * ```json
 * { "mercure": { "publish": [], "subscribe": ["/api/users/42/notifications"] }, "exp": … }
 * ```
 *
 * Le jeton est signé avec le secret HS256 partagé avec le hub, via la fabrique
 * configurée par symfony/mercure-bundle : c'est donc exactement la clé que le hub
 * utilise déjà pour vérifier les publications du backend. Si l'infrastructure vient à
 * séparer clé d'édition et clé d'abonnement, c'est ici — et uniquement ici — qu'il
 * faudra injecter une seconde fabrique.
 */
final readonly class MercureSubscriptionFactory
{
    public function __construct(
        private HubInterface $hub,
        /**
         * Durée de vie du JWT abonné, alignée par défaut sur celle du jeton d'API.
         */
        #[Autowire(param: 'app.mercure.subscriber_ttl')]
        private int $ttlSeconds = 3600,
    ) {
    }

    public function forUser(User $user): MercureSubscription
    {
        $topic = NotificationTopics::forUser($user);
        $factory = $this->hub->getFactory();

        if (null === $factory) {
            throw new \LogicException('Le hub Mercure est configuré sans fabrique de jeton : impossible d\'émettre un JWT abonné.');
        }

        return new MercureSubscription(
            hubUrl: $this->hub->getPublicUrl(),
            topic: $topic,
            token: $factory->create(
                // `publish: []` et non `null` : `null` ferait disparaître la clé du
                // jeton, ce que le hub interprète comme « aucune restriction ».
                subscribe: [$topic],
                publish: [],
                // `exp` explicite : la fabrique du bundle n'en pose aucun par défaut,
                // et un jeton perpétuel confié à un navigateur ne se révoque jamais.
                // Construit depuis un timestamp entier : avec des microsecondes,
                // lcobucci sérialise `exp` en flottant, que tous les vérificateurs
                // JWT n'acceptent pas.
                additionalClaims: ['exp' => new \DateTimeImmutable('@'.(time() + max(60, $this->ttlSeconds)))],
            ),
        );
    }
}
