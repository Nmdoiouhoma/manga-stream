<?php

declare(strict_types=1);

namespace App\Tests\Api;

use App\Service\Notification\NotificationTopics;

/**
 * Émission du JWT abonné remis au frontend.
 *
 * Ce jeton est la seule chose qui permet au navigateur de recevoir des updates
 * `private`. Les tests vérifient donc les deux propriétés qui comptent : il ne porte
 * **que** le topic de son porteur, et il **n'autorise aucune publication**.
 */
final class MercureSubscriptionTest extends ApiTestCase
{
    /**
     * @return array<string, mixed>
     */
    private static function claimsOf(string $jwt): array
    {
        $parts = explode('.', $jwt);
        self::assertCount(3, $parts, 'Le jeton doit être un JWT compact signé.');

        $payload = base64_decode(strtr($parts[1], '-_', '+/').str_repeat('=', (4 - \strlen($parts[1]) % 4) % 4), true);
        self::assertIsString($payload);

        /** @var array<string, mixed> $claims */
        $claims = json_decode($payload, true, flags: \JSON_THROW_ON_ERROR);

        return $claims;
    }

    public function testTheEndpointRequiresAuthentication(): void
    {
        $this->client()->request('GET', '/api/mercure/subscription');

        self::assertResponseStatusCodeSame(401);
    }

    public function testTheTokenIsScopedToTheBearerTopicOnly(): void
    {
        $user = $this->createUser('abonne@example.com', 'abonne');
        $other = $this->createUser('voisin@example.com', 'voisin');
        $userId = (int) $user->getId();
        $otherId = (int) $other->getId();

        $response = $this->client($this->tokenFor($user))->request('GET', '/api/mercure/subscription');

        self::assertResponseIsSuccessful();

        /** @var array{hubUrl: string, topic: string, token: string} $body */
        $body = $response->toArray();

        self::assertSame(NotificationTopics::forUserId($userId), $body['topic']);
        self::assertNotSame('', $body['hubUrl']);

        $claims = self::claimsOf($body['token']);
        /** @var array{subscribe: list<string>, publish: list<string>} $mercure */
        $mercure = $claims['mercure'];

        self::assertSame([NotificationTopics::forUserId($userId)], $mercure['subscribe']);
        self::assertNotContains(
            NotificationTopics::forUserId($otherId),
            $mercure['subscribe'],
            'Le jeton ne doit jamais donner accès au topic d\'un autre compte.',
        );
        self::assertSame([], $mercure['publish'], 'Seul le backend publie ; le client n\'a aucun droit d\'édition.');
    }

    /**
     * Un jeton sans expiration confié à un navigateur ne se révoque jamais.
     */
    public function testTheTokenExpires(): void
    {
        $user = $this->createUser('expirable@example.com', 'expirable');

        $response = $this->client($this->tokenFor($user))->request('GET', '/api/mercure/subscription');
        $claims = self::claimsOf($response->toArray()['token']);

        self::assertArrayHasKey('exp', $claims);
        self::assertGreaterThan(time(), (int) $claims['exp']);
    }

    /**
     * Le client doit pouvoir ouvrir son flux dès la connexion, sans second appel.
     */
    public function testLoginCarriesTheSubscription(): void
    {
        $user = $this->createUser('connexion@example.com', 'connexion');
        $userId = (int) $user->getId();

        $response = $this->client()->request('POST', '/api/login', [
            'headers' => ['Content-Type' => 'application/json'],
            'json' => ['email' => 'connexion@example.com', 'password' => 'motdepasse1'],
        ]);

        self::assertResponseIsSuccessful();

        /** @var array{token: string, mercure: array{hubUrl: string, topic: string, token: string}} $body */
        $body = $response->toArray();

        self::assertArrayHasKey('mercure', $body);
        self::assertSame(NotificationTopics::forUserId($userId), $body['mercure']['topic']);
        self::assertSame(
            [NotificationTopics::forUserId($userId)],
            self::claimsOf($body['mercure']['token'])['mercure']['subscribe'],
        );
        self::assertNotSame($body['token'], $body['mercure']['token'], 'Jeton d\'API et jeton Mercure sont deux jetons distincts.');
    }
}
