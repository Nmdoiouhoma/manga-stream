<?php

declare(strict_types=1);

namespace App\Security;

use Symfony\Component\HttpFoundation\RateLimiter\AbstractRequestRateLimiter;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\RateLimiter\LimiterInterface;
use Symfony\Component\RateLimiter\RateLimiterFactoryInterface;
use Symfony\Component\Security\Http\SecurityRequestAttributes;

/**
 * Limiteur de `POST /api/login`, branché sur le `login_throttling` natif de Symfony.
 *
 * Pourquoi ne pas garder `DefaultLoginRateLimiter` : il n'expose que deux compteurs,
 * l'un par IP et l'autre par couple (IP, identifiant). Les deux clés contiennent
 * l'IP. Un attaquant qui dispose d'un carnet d'adresses — botnet, sortie Tor, pool
 * de proxys résidentiels — change d'IP à chaque essai et n'atteint jamais aucune des
 * deux limites, tout en martelant un seul compte. C'est exactement l'attaque qu'on
 * cherche à arrêter.
 *
 * On ajoute donc un troisième compteur indexé sur le SEUL identifiant visé. Le socle
 * `AbstractRequestRateLimiter` combine les trois et retient le plus restrictif.
 *
 * Les clés sont hachées (HMAC-SHA256 tronqué, clé = secret applicatif) avant d'aller
 * dans le cache : ni e-mail ni adresse IP ne sont écrits en clair dans un stockage
 * qui n'a pas été pensé pour des données personnelles. Même parti pris que Symfony.
 */
final class LoginRateLimiter extends AbstractRequestRateLimiter
{
    public function __construct(
        private readonly RateLimiterFactoryInterface $ipLimiter,
        private readonly RateLimiterFactoryInterface $ipIdentifierLimiter,
        private readonly RateLimiterFactoryInterface $identifierLimiter,
        #[\SensitiveParameter]
        private readonly string $secret,
    ) {
    }

    /**
     * @return LimiterInterface[]
     */
    protected function getLimiters(Request $request): array
    {
        $identifier = (string) $request->attributes->get(SecurityRequestAttributes::LAST_USERNAME, '');
        // Casse insensible : sinon « Alice@example.com » et « alice@example.com »
        // ouvrent deux compteurs pour un seul et même compte.
        $identifier = preg_match('//u', $identifier)
            ? mb_strtolower($identifier, 'UTF-8')
            : strtolower($identifier);

        $ip = (string) $request->getClientIp();

        return [
            $this->ipLimiter->create($this->hash($ip)),
            $this->ipIdentifierLimiter->create($this->hash($identifier.'-'.$ip)),
            $this->identifierLimiter->create($this->hash($identifier)),
        ];
    }

    private function hash(string $data): string
    {
        return strtr(substr(base64_encode(hash_hmac('sha256', $data, $this->secret, true)), 0, 12), '/+', '._');
    }
}
