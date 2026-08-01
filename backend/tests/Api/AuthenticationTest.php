<?php

declare(strict_types=1);

namespace App\Tests\Api;

use App\Entity\User;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * Inscription, connexion et profil courant.
 */
final class AuthenticationTest extends ApiTestCase
{
    public function testRegistrationHashesThePassword(): void
    {
        $this->client()->request('POST', '/api/register', [
            'headers' => ['Content-Type' => 'application/ld+json'],
            'json' => [
                'email' => 'nouvelle@example.com',
                'username' => 'nouvelle',
                'plainPassword' => 'motdepasse1',
            ],
        ]);

        self::assertResponseStatusCodeSame(201);
        self::assertJsonContains(['email' => 'nouvelle@example.com', 'username' => 'nouvelle']);

        $user = $this->em()->getRepository(User::class)->findOneBy(['email' => 'nouvelle@example.com']);
        self::assertNotNull($user);
        self::assertNotSame('motdepasse1', $user->getPassword(), 'Le mot de passe ne doit jamais être stocké en clair.');
        self::assertTrue(
            self::getContainer()->get(UserPasswordHasherInterface::class)->isPasswordValid($user, 'motdepasse1'),
            'Le hachage doit être vérifiable.',
        );
    }

    public function testThePasswordIsNeverSerialized(): void
    {
        $this->client()->request('POST', '/api/register', [
            'headers' => ['Content-Type' => 'application/ld+json'],
            'json' => ['email' => 'discrete@example.com', 'username' => 'discrete', 'plainPassword' => 'motdepasse1'],
        ]);

        $body = (string) self::getClient()->getResponse()->getContent();
        self::assertStringNotContainsString('password', $body);
        self::assertStringNotContainsString('motdepasse1', $body);
    }

    /**
     * Faille évidente si les rôles restaient dans le groupe d'écriture : s'inscrire
     * administrateur en une requête.
     */
    public function testRegistrationCannotGrantAdminRole(): void
    {
        $this->client()->request('POST', '/api/register', [
            'headers' => ['Content-Type' => 'application/ld+json'],
            'json' => [
                'email' => 'malin@example.com',
                'username' => 'malin',
                'plainPassword' => 'motdepasse1',
                'roles' => ['ROLE_ADMIN'],
            ],
        ]);

        self::assertResponseStatusCodeSame(201);

        $user = $this->em()->getRepository(User::class)->findOneBy(['email' => 'malin@example.com']);
        self::assertNotNull($user);
        self::assertSame(['ROLE_USER'], $user->getRoles());
    }

    public function testRegistrationRequiresAPassword(): void
    {
        $this->client()->request('POST', '/api/register', [
            'headers' => ['Content-Type' => 'application/ld+json'],
            'json' => ['email' => 'sansmdp@example.com', 'username' => 'sansmdp'],
        ]);

        self::assertResponseStatusCodeSame(422);
    }

    public function testLoginReturnsAUsableToken(): void
    {
        $this->createUser('alice@example.com', 'alice');

        $this->client()->request('POST', '/api/login', [
            'headers' => ['Content-Type' => 'application/json'],
            'json' => ['email' => 'alice@example.com', 'password' => 'motdepasse1'],
        ]);

        self::assertResponseIsSuccessful();

        $token = json_decode((string) self::getClient()->getResponse()->getContent(), true)['token'] ?? null;
        self::assertIsString($token);

        // Le jeton obtenu doit réellement ouvrir une ressource protégée : c'est ce qui
        // avait cassé silencieusement (identité écrite sous le mauvais claim).
        $this->client($token)->request('GET', '/api/me');
        self::assertResponseIsSuccessful();
        self::assertJsonContains(['email' => 'alice@example.com', 'username' => 'alice']);
    }

    public function testLoginWithAWrongPasswordIsRejected(): void
    {
        $this->createUser('alice@example.com', 'alice');

        $this->client()->request('POST', '/api/login', [
            'headers' => ['Content-Type' => 'application/json'],
            'json' => ['email' => 'alice@example.com', 'password' => 'mauvais-mot-de-passe'],
        ]);

        self::assertResponseStatusCodeSame(401);
    }

    public function testLoginWithAnUnknownAccountIsRejected(): void
    {
        $this->client()->request('POST', '/api/login', [
            'headers' => ['Content-Type' => 'application/json'],
            'json' => ['email' => 'fantome@example.com', 'password' => 'motdepasse1'],
        ]);

        self::assertResponseStatusCodeSame(401);
    }

    public function testMeRequiresAToken(): void
    {
        $this->client()->request('GET', '/api/me');

        self::assertResponseStatusCodeSame(401);
    }

    /**
     * Le listing des comptes exposerait tous les e-mails : réservé aux administrateurs.
     */
    public function testListingUsersIsForbiddenToRegularAccounts(): void
    {
        $this->client()->request('GET', '/api/users');
        self::assertResponseStatusCodeSame(401);

        $token = $this->tokenFor($this->createUser('alice@example.com', 'alice'));
        $this->client($token)->request('GET', '/api/users');
        self::assertResponseStatusCodeSame(403);

        $adminToken = $this->tokenFor($this->createUser('admin@example.com', 'admin', admin: true));
        $this->client($adminToken)->request('GET', '/api/users');
        self::assertResponseIsSuccessful();
    }
}
