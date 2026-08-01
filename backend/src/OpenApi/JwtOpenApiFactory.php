<?php

declare(strict_types=1);

namespace App\OpenApi;

use ApiPlatform\OpenApi\Factory\OpenApiFactoryInterface;
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

    public function __construct(
        #[AutowireDecorated]
        private OpenApiFactoryInterface $decorated,
    ) {
    }

    public function __invoke(array $context = []): OpenApi
    {
        $openApi = ($this->decorated)($context);

        $schemes = $openApi->getComponents()->getSecuritySchemes();
        if (null === $schemes || !isset($schemes[self::SCHEME])) {
            // Lexik n'a pas tourné (intégration API Platform désactivée, ou aucun
            // firewall json_login détecté) : rien à référencer, on n'invente pas
            // un schéma qui ne correspondrait à aucune configuration réelle.
            return $openApi;
        }

        return $openApi->withSecurity([[self::SCHEME => []]]);
    }
}
