<?php

declare(strict_types=1);

namespace App\Tests\Api;

use Symfony\Component\Cache\Adapter\ArrayAdapter;
use Symfony\Component\RateLimiter\RateLimiterFactory;
use Symfony\Component\RateLimiter\Storage\CacheStorage;

/**
 * Limitation de débit des points d'entrée publics.
 *
 * Deux mesures au curl, avant ce garde-fou : 12 échecs de connexion d'affilée sur le
 * même compte renvoyaient 12 × 401 sans jamais bloquer, et 5 inscriptions en rafale
 * renvoyaient 5 × 201. La force brute et la création de comptes en masse étaient donc
 * l'une et l'autre gratuites.
 */
final class RateLimitTest extends ApiTestCase
{
    private const JSON = ['headers' => ['Content-Type' => 'application/json']];
    private const LD_JSON = ['headers' => ['Content-Type' => 'application/ld+json']];

    /**
     * @return int[] la séquence des statuts renvoyés
     */
    private function failLogin(string $email, int $times): array
    {
        $codes = [];

        for ($i = 0; $i < $times; ++$i) {
            $this->client()->request('POST', '/api/login', self::JSON + [
                'json' => ['email' => $email, 'password' => 'mot-de-passe-faux'],
            ]);
            $codes[] = self::getClient()->getResponse()->getStatusCode();
        }

        return $codes;
    }

    public function testTheTwelveFailedLoginsAreBlockedAfterFive(): void
    {
        $this->createUser('cible@example.com', 'cible');

        $codes = $this->failLogin('cible@example.com', 12);

        self::assertSame(
            [401, 401, 401, 401, 401, 429, 429, 429, 429, 429, 429, 429],
            $codes,
            'Cinq essais, puis blocage : la rafale de 12 ne doit plus passer entière.',
        );
    }

    /**
     * Un 429 sans `Retry-After` laisse le client réessayer au hasard, ce qui aggrave
     * la charge au lieu de la réduire.
     */
    public function testTheBlockedLoginAnnouncesItsDelay(): void
    {
        $this->createUser('delai@example.com', 'delai');

        $this->failLogin('delai@example.com', 6);

        $response = self::getClient()->getResponse();
        self::assertSame(429, $response->getStatusCode());
        self::assertSame('900', $response->headers->get('Retry-After'), 'La fenêtre configurée est de 15 minutes.');

        // Forme d'erreur propre à lexik, celle que le contrat documente déjà pour le
        // 401 de cet endpoint — pas du application/problem+json.
        $body = json_decode((string) $response->getContent(), true);
        self::assertSame(429, $body['code'] ?? null);
        self::assertIsString($body['message'] ?? null);
    }

    /**
     * Le bon mot de passe ne rouvre pas la porte pendant le blocage : sinon
     * l'attaquant saurait, à la première réponse non-429, qu'il a trouvé.
     */
    public function testTheBlockSurvivesTheCorrectPassword(): void
    {
        $this->createUser('verrou@example.com', 'verrou');

        $this->failLogin('verrou@example.com', 6);

        $this->client()->request('POST', '/api/login', self::JSON + [
            'json' => ['email' => 'verrou@example.com', 'password' => 'motdepasse1'],
        ]);

        self::assertResponseStatusCodeSame(429);
    }

    /**
     * Le compteur principal est indexé sur le couple (IP, identifiant) : un compte
     * martelé ne doit pas emporter les autres comptes de la même IP.
     */
    public function testAnotherAccountFromTheSameAddressStillWorks(): void
    {
        $this->createUser('bruyant@example.com', 'bruyant');
        $this->createUser('paisible@example.com', 'paisible');

        $this->failLogin('bruyant@example.com', 6);

        $this->client()->request('POST', '/api/login', self::JSON + [
            'json' => ['email' => 'paisible@example.com', 'password' => 'motdepasse1'],
        ]);

        self::assertResponseIsSuccessful();
    }

    /**
     * @return int[]
     */
    private function register(int $times, string $path = '/api/register'): array
    {
        $codes = [];

        for ($i = 0; $i < $times; ++$i) {
            $this->client()->request('POST', $path, self::LD_JSON + [
                'json' => [
                    'email' => \sprintf('rafale%d@example.com', $i),
                    'username' => \sprintf('rafale%d', $i),
                    'plainPassword' => 'motdepasse1',
                ],
            ]);
            $codes[] = self::getClient()->getResponse()->getStatusCode();
        }

        return $codes;
    }

    public function testTheRegistrationBurstIsCutAfterThreeAccounts(): void
    {
        self::assertSame([201, 201, 201, 429, 429], $this->register(5));
    }

    /**
     * `POST /api/users` est l'alias déprécié de l'inscription. S'il avait son propre
     * quota, il suffirait d'alterner les deux chemins pour doubler le nombre de
     * comptes créables : le compteur doit être commun.
     */
    public function testTheDeprecatedAliasSharesTheRegistrationCounter(): void
    {
        $this->register(3);

        $this->client()->request('POST', '/api/users', self::LD_JSON + [
            'json' => ['email' => 'detour@example.com', 'username' => 'detour', 'plainPassword' => 'motdepasse1'],
        ]);

        self::assertResponseStatusCodeSame(429);
        self::assertNotNull(self::getClient()->getResponse()->headers->get('Retry-After'));
    }

    /**
     * Le compteur se vide une fois la fenêtre écoulée — un blocage définitif serait
     * un déni de service offert à l'attaquant.
     *
     * Vérifié sur la politique elle-même, avec une fenêtre d'une seconde : la
     * traverser sur les 15 minutes réelles de `login_ip_identifier` demanderait soit
     * d'attendre, soit de truquer l'horloge, et `SlidingWindowLimiter` lit
     * directement `microtime()` — il n'accepte aucune horloge injectée.
     */
    public function testASlidingWindowFreesItsQuotaOnceElapsed(): void
    {
        $factory = new RateLimiterFactory(
            ['id' => 'test-fenetre', 'policy' => 'sliding_window', 'limit' => 2, 'interval' => '1 second'],
            new CacheStorage(new ArrayAdapter()),
        );
        $limiter = $factory->create('une-cle');

        self::assertTrue($limiter->consume()->isAccepted());
        self::assertTrue($limiter->consume()->isAccepted());
        self::assertFalse($limiter->consume()->isAccepted(), 'Le quota doit être épuisé.');

        usleep(1_200_000);

        self::assertTrue($limiter->consume()->isAccepted(), 'La fenêtre écoulée, le quota doit être de nouveau disponible.');
    }
}
