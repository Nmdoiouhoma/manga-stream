<?php

declare(strict_types=1);

namespace App\Tests\Api;

use App\Entity\User;

/**
 * Modification de son propre compte : `PATCH /api/users/{id}`.
 *
 * L'opération existait, protégée par {@see \App\Validator\CurrentPasswordRequired},
 * mais **aucun test ne la couvrait** — alors qu'elle est la seule à pouvoir enfermer
 * quelqu'un hors de son compte. Elle est désormais exposée par l'écran de profil, ce
 * qui rend cette absence intenable.
 *
 * Le test le plus important est {@see testChangingTheEmailInvalidatesTheCurrentToken()} :
 * il documente un comportement qui n'a rien d'évident et que l'interface doit
 * anticiper, sous peine de laisser l'utilisateur devant une application qui se
 * déconnecte toute seule après une modification réussie.
 */
final class ProfileUpdateTest extends ApiTestCase
{
    private function patch(User $user, string $token, array $body): void
    {
        $this->client($token)->request('PATCH', '/api/users/'.$user->getId(), [
            'headers' => ['Content-Type' => 'application/merge-patch+json'],
            'json' => $body,
        ]);
    }

    public function testTheUsernameCanBeChanged(): void
    {
        $user = $this->createUser('pseudo@example.com', 'ancienpseudo');
        $token = $this->tokenFor($user);

        $this->patch($user, $token, ['username' => 'nouveaupseudo']);

        self::assertResponseIsSuccessful();
        self::assertSame('nouveaupseudo', $this->reattach($user)->getUsername());
        self::assertSame('pseudo@example.com', $this->reattach($user)->getEmail());
    }

    /**
     * L'identifiant de connexion est l'email (`security.yaml`, `property: email`).
     * Un jeton émis pour l'ancienne adresse ne désigne donc plus personne dès que
     * l'adresse change : la requête suivante part en 401, et le front doit traiter ce
     * cas comme une reconnexion attendue, pas comme une panne.
     */
    public function testChangingTheEmailInvalidatesTheCurrentToken(): void
    {
        $user = $this->createUser('avant@example.com', 'changeemail');
        $token = $this->tokenFor($user);

        $this->patch($user, $token, ['email' => 'apres@example.com']);
        self::assertResponseIsSuccessful();
        self::assertSame('apres@example.com', $this->reattach($user)->getEmail());

        $this->client($token)->request('GET', '/api/me');
        self::assertResponseStatusCodeSame(401);
    }

    public function testChangingThePasswordRequiresTheCurrentOne(): void
    {
        $user = $this->createUser('motdepasse@example.com', 'motdepasse');
        $token = $this->tokenFor($user);

        $this->patch($user, $token, ['plainPassword' => 'nouveaumotdepasse1']);

        self::assertResponseStatusCodeSame(422);
    }

    public function testAWrongCurrentPasswordIsRejected(): void
    {
        $user = $this->createUser('faux@example.com', 'fauxactuel');
        $token = $this->tokenFor($user);

        $this->patch($user, $token, [
            'plainPassword' => 'nouveaumotdepasse1',
            'currentPassword' => 'ce-n-est-pas-le-bon',
        ]);

        self::assertResponseStatusCodeSame(422);
    }

    public function testThePasswordIsChangedWhenTheCurrentOneIsGiven(): void
    {
        $user = $this->createUser('valide@example.com', 'valide');
        $token = $this->tokenFor($user);

        $this->patch($user, $token, [
            'plainPassword' => 'nouveaumotdepasse1',
            'currentPassword' => 'motdepasse1',
        ]);

        self::assertResponseIsSuccessful();

        // Le nouveau mot de passe ouvre bien une session, l'ancien non.
        $this->client()->request('POST', '/api/login', [
            'headers' => ['Content-Type' => 'application/json'],
            'json' => ['email' => 'valide@example.com', 'password' => 'nouveaumotdepasse1'],
        ]);
        self::assertResponseIsSuccessful();

        $this->client()->request('POST', '/api/login', [
            'headers' => ['Content-Type' => 'application/json'],
            'json' => ['email' => 'valide@example.com', 'password' => 'motdepasse1'],
        ]);
        self::assertResponseStatusCodeSame(401);
    }

    /**
     * Un PATCH sans `plainPassword` laisse le mot de passe intact — sans quoi changer
     * son pseudo obligerait à ressaisir son mot de passe à chaque fois.
     */
    public function testUpdatingTheProfileDoesNotTouchThePassword(): void
    {
        $user = $this->createUser('intact@example.com', 'intact');
        $token = $this->tokenFor($user);
        $hashBefore = $this->reattach($user)->getPassword();

        $this->patch($user, $token, ['username' => 'intactbis']);

        self::assertResponseIsSuccessful();
        self::assertSame($hashBefore, $this->reattach($user)->getPassword());
    }

    public function testSomeoneElsesAccountCannotBeModified(): void
    {
        $victim = $this->createUser('victime@example.com', 'victime');
        $attacker = $this->createUser('curieux@example.com', 'curieux');

        $this->patch($victim, $this->tokenFor($attacker), ['username' => 'pirate']);

        self::assertResponseStatusCodeSame(403);
        self::assertSame('victime', $this->reattach($victim)->getUsername());
    }

    /**
     * `roles` n'est dans aucun groupe d'écriture : le champ doit être ignoré, pas
     * appliqué. Un compte ne se promeut pas administrateur tout seul.
     */
    public function testRolesCannotBeSelfGranted(): void
    {
        $user = $this->createUser('ambitieux@example.com', 'ambitieux');
        $token = $this->tokenFor($user);

        $this->patch($user, $token, ['username' => 'ambitieux', 'roles' => ['ROLE_ADMIN']]);

        self::assertNotContains('ROLE_ADMIN', $this->reattach($user)->getRoles());
    }

    public function testAnAlreadyTakenUsernameIsRejected(): void
    {
        $this->createUser('premier@example.com', 'occupe');
        $user = $this->createUser('second@example.com', 'libre');

        $this->patch($user, $this->tokenFor($user), ['username' => 'occupe']);

        self::assertResponseStatusCodeSame(422);

        // Relecture depuis la base, et non via `reattach()` : la dénormalisation a bien
        // écrit sur l'entité gérée avant que la validation ne rejette la requête, si
        // bien que l'objet en mémoire porte la valeur refusée. Seule la base fait foi —
        // elle n'a jamais été flushée.
        $this->em()->clear();
        $reloaded = $this->em()->getRepository(User::class)->findOneBy(['email' => 'second@example.com']);
        self::assertSame('libre', $reloaded?->getUsername());
    }
}
