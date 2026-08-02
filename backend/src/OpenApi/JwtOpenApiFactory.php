<?php

declare(strict_types=1);

namespace App\OpenApi;

use ApiPlatform\OpenApi\Factory\OpenApiFactoryInterface;
use ApiPlatform\OpenApi\Model;
use ApiPlatform\OpenApi\OpenApi;
use Symfony\Component\DependencyInjection\Attribute\AsDecorator;
use Symfony\Component\DependencyInjection\Attribute\AutowireDecorated;

/**
 * Déclare le JWT comme schéma de sécurité par défaut du contrat.
 *
 * Le reste est déjà pris en charge par lexik/jwt-authentication-bundle, qui décore
 * lui aussi la fabrique OpenAPI : il enregistre le `securityScheme` nommé `JWT`
 * (http/bearer) et documente `POST /api/login` à partir de la configuration du
 * firewall `json_login`. On se garde donc d'en déclarer un second, qui ferait
 * double emploi dans le contrat.
 *
 * Il reste une chose qu'API Platform ne peut pas déduire : le jeton est vérifié par
 * un firewall Symfony, invisible depuis les métadonnées des ressources. Sans la
 * `security` globale posée ici, aucune opération du contrat ne référencerait le
 * schéma — Swagger UI n'afficherait pas le bouton « Authorize » et les générateurs
 * de clients ignoreraient purement et simplement l'authentification.
 *
 * Cette `security` est un *défaut* au sens OpenAPI, pas une obligation : la lecture
 * du catalogue reste accessible sans jeton (voir l'attribut `security` de chaque
 * opération dans les entités), et `POST /api/login` déclare explicitement `[]`.
 */
// Priorité négative = décoration appliquée en dernier, donc *à l'extérieur* de celle
// de Lexik : son schéma `JWT` est déjà en place quand ce décorateur s'exécute.
#[AsDecorator('api_platform.openapi.factory', priority: -10)]
final readonly class JwtOpenApiFactory implements OpenApiFactoryInterface
{
    private const SCHEME = 'JWT';
    private const LOGIN_PATH = '/api/login';

    public function __construct(
        #[AutowireDecorated]
        private OpenApiFactoryInterface $decorated,
    ) {
    }

    public function __invoke(array $context = []): OpenApi
    {
        $openApi = ($this->decorated)($context);

        $openApi = $this->describeLoginResponses($openApi);

        $schemes = $openApi->getComponents()->getSecuritySchemes();
        if (null === $schemes || !isset($schemes[self::SCHEME])) {
            // Lexik n'a pas tourné (intégration API Platform désactivée, ou aucun
            // firewall json_login détecté) : rien à référencer, on n'invente pas
            // un schéma qui ne correspondrait à aucune configuration réelle.
            return $openApi;
        }

        return $openApi->withSecurity([[self::SCHEME => []]]);
    }

    /**
     * Complète la description de `POST /api/login`, que Lexik réduit au seul `200`.
     *
     * Deux conséquences très concrètes de ce contrat incomplet côté client : un
     * générateur comme `openapi-fetch` type `error` en `never`, ce qui oblige à
     * relire le statut sur l'objet `Response` au lieu de s'appuyer sur le type ; et
     * rien n'indique que l'échec d'authentification et la requête malformée ne
     * renvoient pas du tout la même forme de corps.
     *
     * On décrit donc les deux, tels qu'ils sortent réellement :
     *  - `401` : le format propre à Lexik, `{code, message}` — ce n'est PAS du
     *    `application/problem+json`, contrairement aux erreurs d'API Platform ;
     *  - `400` : la requête n'atteint jamais l'authentificateur (JSON illisible ou
     *    clé `email`/`password` absente) et c'est le gestionnaire d'exceptions de
     *    Symfony qui répond, au format RFC 7807.
     *
     * Le `200` est également enrichi : la réponse porte désormais un bloc `mercure`
     * ({@see \App\EventListener\MercureSubscriptionOnLoginListener}).
     */
    private function describeLoginResponses(OpenApi $openApi): OpenApi
    {
        $path = $openApi->getPaths()->getPath(self::LOGIN_PATH);
        $operation = $path?->getPost();

        if (null === $path || null === $operation) {
            return $openApi;
        }

        $operation = $operation
            ->withResponse(200, new Model\Response(
                description: 'Jeton créé. `mercure` porte de quoi ouvrir immédiatement le flux temps réel.',
                content: new \ArrayObject([
                    'application/json' => ['schema' => self::successSchema()],
                ]),
            ))
            ->withResponse(401, new Model\Response(
                description: 'Identifiants invalides. Corps propre à lexik/jwt-authentication-bundle, pas du application/problem+json.',
                content: new \ArrayObject([
                    'application/json' => ['schema' => self::unauthorizedSchema()],
                ]),
            ))
            ->withResponse(400, new Model\Response(
                description: 'Requête malformée : JSON illisible, ou clé `email`/`password` absente. Réponse du gestionnaire d\'exceptions de Symfony (RFC 7807).',
                content: new \ArrayObject([
                    'application/json' => ['schema' => self::badRequestSchema()],
                ]),
            ));

        $openApi->getPaths()->addPath(self::LOGIN_PATH, $path->withPost($operation));

        return $openApi;
    }

    /**
     * @return array<string, mixed>
     */
    private static function successSchema(): array
    {
        return [
            'type' => 'object',
            'required' => ['token'],
            'properties' => [
                'token' => [
                    'type' => 'string',
                    'readOnly' => true,
                    'description' => 'JWT d\'API, à présenter en `Authorization: Bearer`.',
                ],
                'mercure' => [
                    'type' => 'object',
                    'description' => 'Abonnement Mercure de l\'utilisateur. Absent si l\'émission du jeton a échoué ; utiliser alors `GET /api/mercure/subscription`.',
                    'required' => ['hubUrl', 'topic', 'token'],
                    'properties' => [
                        'hubUrl' => ['type' => 'string', 'example' => 'http://localhost:3000/.well-known/mercure'],
                        'topic' => ['type' => 'string', 'example' => '/api/users/42/notifications'],
                        'token' => ['type' => 'string', 'description' => 'JWT abonné, `mercure.subscribe` restreint à `topic`.'],
                    ],
                ],
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function unauthorizedSchema(): array
    {
        return [
            'type' => 'object',
            'required' => ['code', 'message'],
            'properties' => [
                'code' => ['type' => 'integer', 'example' => 401],
                'message' => ['type' => 'string', 'example' => 'Invalid credentials.'],
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function badRequestSchema(): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'type' => ['type' => 'string', 'example' => 'https://tools.ietf.org/html/rfc2616#section-10'],
                'title' => ['type' => 'string', 'example' => 'An error occurred'],
                'status' => ['type' => 'integer', 'example' => 400],
                'detail' => ['type' => 'string', 'example' => 'The key "password" must be provided.'],
            ],
        ];
    }
}
