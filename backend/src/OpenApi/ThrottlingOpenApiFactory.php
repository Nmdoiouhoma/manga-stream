<?php

declare(strict_types=1);

namespace App\OpenApi;

use ApiPlatform\OpenApi\Factory\OpenApiFactoryInterface;
use ApiPlatform\OpenApi\Model;
use ApiPlatform\OpenApi\OpenApi;
use Symfony\Component\DependencyInjection\Attribute\AsDecorator;
use Symfony\Component\DependencyInjection\Attribute\AutowireDecorated;

/**
 * Documente les `429` des points d'entrée publics.
 *
 * Une limitation de débit non documentée est une panne pour le client : rien dans le
 * contrat n'annonce le statut, `openapi-fetch` type donc `error` sans lui, et le
 * frontend découvre le blocage en production — sous la forme d'un écran d'erreur
 * générique, sans le délai d'attente que le serveur lui donnait pourtant.
 *
 * Les 429 ne sont pas décrits sur les entités : ils ne viennent pas des métadonnées
 * de ressource mais d'un pare-feu Symfony (connexion) et d'un listener de requête
 * (inscription, mot de passe oublié), tous deux invisibles pour API Platform.
 *
 * Priorité -20 : ce décorateur s'applique après {@see JwtOpenApiFactory} (-10), qui
 * réécrit lui aussi les réponses de `POST /api/login`. L'ordre importe — la
 * réécriture de Lexik doit être passée avant qu'on ajoute le 429.
 */
#[AsDecorator('api_platform.openapi.factory', priority: -20)]
final readonly class ThrottlingOpenApiFactory implements OpenApiFactoryInterface
{
    /**
     * Chemins limités, et la description de leur quota. `POST` uniquement : aucune
     * lecture n'est limitée.
     */
    private const THROTTLED = [
        '/api/login' => '5 tentatives par quart d\'heure et par compte visé, depuis une même adresse IP ; un plafond distinct s\'applique à l\'adresse IP seule et au compte seul, toutes adresses confondues.',
        '/api/register' => '3 comptes par heure et par adresse IP. Le quota est PARTAGÉ avec `POST /api/users`, son alias déprécié.',
        '/api/users' => '3 comptes par heure et par adresse IP. Quota partagé avec `POST /api/register`.',
        '/api/password/forgot' => '5 demandes par heure et par adresse IP. Une limite distincte, par adresse e-mail visée, coupe l\'envoi du message sans changer le statut de la réponse.',
        '/api/password/reset' => '5 tentatives par heure et par adresse IP.',
    ];

    public function __construct(
        #[AutowireDecorated]
        private OpenApiFactoryInterface $decorated,
    ) {
    }

    public function __invoke(array $context = []): OpenApi
    {
        $openApi = ($this->decorated)($context);
        $paths = $openApi->getPaths();

        foreach (self::THROTTLED as $path => $quota) {
            $item = $paths->getPath($path);
            $operation = $item?->getPost();

            if (null === $item || null === $operation) {
                continue;
            }

            $paths->addPath($path, $item->withPost(
                $operation->withResponse(429, self::response($path, $quota)),
            ));
        }

        return $openApi;
    }

    private static function response(string $path, string $quota): Model\Response
    {
        // `POST /api/login` est servi par lexik, dont TOUTES les erreurs ont la forme
        // `{code, message}` — c'est déjà ce que le contrat décrit pour son 401. Le
        // reste de l'API répond en `application/problem+json` comme n'importe quelle
        // erreur API Platform. Chaque endpoint garde donc SA forme d'erreur plutôt
        // que d'en introduire une troisième pour le seul 429.
        $isLogin = '/api/login' === $path;

        return new Model\Response(
            description: \sprintf(
                "Trop de requêtes. Quota : %s\n\nL'en-tête `Retry-After` donne le délai d'attente EN SECONDES ; il est toujours présent.",
                $quota,
            ),
            content: new \ArrayObject([
                ($isLogin ? 'application/json' : 'application/problem+json') => [
                    'schema' => $isLogin ? self::loginSchema() : self::problemSchema(),
                ],
            ]),
            headers: new \ArrayObject([
                'Retry-After' => [
                    'description' => 'Délai avant nouvelle tentative, en secondes.',
                    'schema' => ['type' => 'integer', 'example' => 900],
                ],
            ]),
        );
    }

    /**
     * @return array<string, mixed>
     */
    private static function loginSchema(): array
    {
        return [
            'type' => 'object',
            'required' => ['code', 'message'],
            'properties' => [
                'code' => ['type' => 'integer', 'example' => 429],
                'message' => ['type' => 'string', 'example' => 'Trop de tentatives de connexion. Réessayez dans 15 minutes.'],
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function problemSchema(): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'type' => ['type' => 'string', 'example' => 'https://tools.ietf.org/html/rfc6585#section-4'],
                'title' => ['type' => 'string', 'example' => 'An error occurred'],
                'status' => ['type' => 'integer', 'example' => 429],
                'detail' => ['type' => 'string', 'example' => 'Trop de comptes créés depuis cette adresse. Réessayez plus tard.'],
            ],
        ];
    }
}
