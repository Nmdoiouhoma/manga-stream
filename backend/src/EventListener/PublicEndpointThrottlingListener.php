<?php

declare(strict_types=1);

namespace App\EventListener;

use App\Security\ThrottleResponse;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\HttpKernel\KernelEvents;
use Symfony\Component\RateLimiter\RateLimiterFactoryInterface;

/**
 * Limitation de débit des points d'entrée publics autres que la connexion.
 *
 * `POST /api/login` est couvert par le `login_throttling` natif de Symfony, qui a
 * accès au passeport d'authentification et sait donc de quel compte il s'agit. Les
 * endpoints traités ici n'ont pas d'équivalent natif : ils sont simplement ouverts,
 * et sans compteur ils s'utilisent à volonté.
 *
 * Deux d'entre eux méritent une mention :
 *
 *  - `POST /api/users` partage le compteur de `POST /api/register`. C'est l'alias
 *    déprécié de l'inscription, toujours en service pour ne pas casser le client
 *    existant. Lui donner son propre quota — ou l'oublier — reviendrait à laisser la
 *    porte de derrière grande ouverte : on doublerait simplement le nombre de comptes
 *    créables par heure en alternant les deux chemins.
 *  - `POST /api/password/forgot` est limité ICI par IP seulement. Le second garde-fou,
 *    par adresse visée, vit dans le processor : il coupe l'envoi du mail sans changer
 *    le statut de la réponse, sans quoi le 429 rendrait à l'endpoint le rôle d'oracle
 *    d'énumération que son 204 systématique lui retire.
 *
 * Priorité 10 : après le routeur (32), avant le pare-feu (8). Un attaquant est ainsi
 * arrêté avant que la moindre requête n'atteigne la base ou le hacheur de mots de
 * passe — c'est précisément ce qui coûte cher sous une rafale.
 */
#[AsEventListener(event: KernelEvents::REQUEST, priority: 10)]
final readonly class PublicEndpointThrottlingListener
{
    public function __construct(
        #[Autowire(service: 'limiter.registration_ip')]
        private RateLimiterFactoryInterface $registrationLimiter,
        #[Autowire(service: 'limiter.password_reset_ip')]
        private RateLimiterFactoryInterface $passwordResetLimiter,
    ) {
    }

    public function __invoke(RequestEvent $event): void
    {
        if (!$event->isMainRequest() || 'POST' !== $event->getRequest()->getMethod()) {
            return;
        }

        $path = rtrim($event->getRequest()->getPathInfo(), '/');

        [$limiter, $detail] = match ($path) {
            '/api/register', '/api/users' => [
                $this->registrationLimiter,
                'Trop de comptes créés depuis cette adresse. Réessayez plus tard.',
            ],
            '/api/password/forgot', '/api/password/reset' => [
                $this->passwordResetLimiter,
                'Trop de demandes de réinitialisation depuis cette adresse. Réessayez plus tard.',
            ],
            default => [null, ''],
        };

        if (null === $limiter) {
            return;
        }

        $limit = $limiter->create((string) $event->getRequest()->getClientIp())->consume();

        if ($limit->isAccepted()) {
            return;
        }

        $event->setResponse(ThrottleResponse::problem(
            $limit->getRetryAfter()->getTimestamp() - time(),
            $detail,
        ));
    }
}
