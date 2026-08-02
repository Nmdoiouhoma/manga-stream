<?php

declare(strict_types=1);

namespace App\EventListener;

use App\Security\ThrottleResponse;
use Lexik\Bundle\JWTAuthenticationBundle\Event\AuthenticationFailureEvent;
use Lexik\Bundle\JWTAuthenticationBundle\Events;
use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\Security\Core\Exception\TooManyLoginAttemptsAuthenticationException;

/**
 * Traduit le blocage de `login_throttling` en 429, au lieu du 401 par défaut.
 *
 * Le piège : le gestionnaire d'échec de lexik dérive le statut HTTP du *code* de
 * l'exception d'authentification, et `TooManyLoginAttemptsAuthenticationException`
 * n'en porte pas. Sans ce listener, un compte bloqué répond donc 401 — strictement
 * indiscernable d'un mot de passe faux. Le client ne peut ni informer l'utilisateur,
 * ni cesser de réessayer : la protection existerait sans que personne ne le sache.
 *
 * `Retry-After` est reconstruit depuis le seuil porté par l'exception, exprimé en
 * minutes (Symfony l'arrondit au supérieur). On perd la seconde près, pas le sens.
 */
#[AsEventListener(event: Events::AUTHENTICATION_FAILURE)]
final readonly class LoginThrottlingFailureListener
{
    public function __invoke(AuthenticationFailureEvent $event): void
    {
        $exception = $event->getException();

        if (!$exception instanceof TooManyLoginAttemptsAuthenticationException) {
            return;
        }

        $minutes = (int) ($exception->getMessageData()['%minutes%'] ?? 0);
        $retryAfter = $minutes > 0 ? $minutes * 60 : 60;

        $event->setResponse(ThrottleResponse::login(
            $retryAfter,
            \sprintf('Trop de tentatives de connexion. Réessayez dans %d minute%s.', max(1, $minutes), $minutes > 1 ? 's' : ''),
        ));
    }
}
