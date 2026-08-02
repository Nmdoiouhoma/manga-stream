<?php

declare(strict_types=1);

namespace App\EventListener;

use App\Entity\User;
use App\Service\Notification\MercureSubscriptionFactory;
use Lexik\Bundle\JWTAuthenticationBundle\Event\AuthenticationSuccessEvent;
use Psr\Log\LoggerInterface;
use Symfony\Component\EventDispatcher\Attribute\AsEventListener;

/**
 * Insère l'abonnement Mercure dans la réponse de `POST /api/login`.
 *
 * ```json
 * {
 *   "token": "<JWT d'API>",
 *   "mercure": {
 *     "hubUrl": "http://localhost:3000/.well-known/mercure",
 *     "topic":  "/api/users/42/notifications",
 *     "token":  "<JWT abonné>"
 *   }
 * }
 * ```
 *
 * Sans cela, le client devrait enchaîner un second appel juste pour ouvrir son flux.
 * Le même contenu reste disponible sur `GET /api/mercure/subscription`, qui sert au
 * renouvellement : le JWT abonné expire indépendamment du jeton d'API.
 *
 * Un échec d'émission ne doit jamais empêcher de se connecter — la clé `mercure` est
 * alors simplement absente, et le client bascule sur l'endpoint dédié.
 */
#[AsEventListener(event: 'lexik_jwt_authentication.on_authentication_success')]
final readonly class MercureSubscriptionOnLoginListener
{
    public function __construct(
        private MercureSubscriptionFactory $factory,
        private LoggerInterface $logger,
    ) {
    }

    public function __invoke(AuthenticationSuccessEvent $event): void
    {
        $user = $event->getUser();

        if (!$user instanceof User) {
            return;
        }

        try {
            $subscription = $this->factory->forUser($user);
        } catch (\Throwable $e) {
            $this->logger->error('Mercure : émission du jeton abonné impossible à la connexion.', [
                'user' => $user->getId(),
                'error' => $e->getMessage(),
            ]);

            return;
        }

        $data = $event->getData();
        $data['mercure'] = [
            'hubUrl' => $subscription->hubUrl,
            'topic' => $subscription->topic,
            'token' => $subscription->token,
        ];

        $event->setData($data);
    }
}
