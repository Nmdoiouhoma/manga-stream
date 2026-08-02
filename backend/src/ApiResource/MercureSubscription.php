<?php

declare(strict_types=1);

namespace App\ApiResource;

use ApiPlatform\Metadata\ApiProperty;
use ApiPlatform\Metadata\ApiResource;
use ApiPlatform\Metadata\Get;
use ApiPlatform\OpenApi\Model;
use App\State\MercureSubscriptionProvider;
use Symfony\Component\Serializer\Attribute\Groups;

/**
 * Tout ce dont le frontend a besoin pour ouvrir son flux temps réel.
 *
 * Le même objet est renvoyé par `GET /api/mercure/subscription` **et** inséré sous la
 * clé `mercure` de la réponse de `POST /api/login` : au premier appel le client a déjà
 * tout en main, et il peut ensuite renouveler le seul jeton Mercure — dont la durée de
 * vie est indépendante de celle du JWT d'API — sans se réauthentifier.
 *
 * Souscription côté navigateur :
 *
 * ```js
 * const url = new URL(hubUrl);
 * url.searchParams.append('topic', topic);
 * // Le hub n'accepte pas d'en-tête Authorization sur un EventSource :
 * // le jeton passe par le cookie `mercureAuthorization` ou par ?authorization=
 * new EventSource(url, { withCredentials: true });
 * ```
 */
#[ApiResource(
    shortName: 'MercureSubscription',
    description: 'Paramètres d\'abonnement au hub Mercure pour l\'utilisateur authentifié.',
    operations: [
        new Get(
            uriTemplate: '/mercure/subscription',
            security: "is_granted('ROLE_USER')",
            provider: MercureSubscriptionProvider::class,
            read: true,
            description: 'Jeton d\'abonnement Mercure, limité au topic personnel du porteur.',
            openapi: new Model\Operation(summary: 'Abonnement Mercure de l\'utilisateur authentifié.'),
        ),
    ],
    normalizationContext: ['groups' => ['mercure:read']],
    // Ressource non identifiée : elle n'a pas d'IRI propre, `@id` serait un mensonge.
    output: self::class,
)]
final readonly class MercureSubscription
{
    public function __construct(
        /**
         * URL publique du hub, telle qu'un navigateur peut la joindre.
         */
        #[ApiProperty(example: 'http://localhost:3000/.well-known/mercure')]
        #[Groups(['mercure:read'])]
        public string $hubUrl,

        /**
         * Unique topic auquel ce jeton donne accès.
         */
        #[ApiProperty(example: '/api/users/42/notifications')]
        #[Groups(['mercure:read'])]
        public string $topic,

        /**
         * JWT abonné signé par le backend (HS256, secret partagé avec le hub).
         * Claim `mercure.subscribe` restreint au seul `topic` ci-dessus.
         */
        #[Groups(['mercure:read'])]
        public string $token,
    ) {
    }
}
