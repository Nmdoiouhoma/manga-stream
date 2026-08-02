<?php

declare(strict_types=1);

namespace App\Tests\Api;

use App\Entity\PasswordResetToken;
use App\Entity\User;
use App\Service\Security\PasswordResetService;
use Symfony\Bundle\FrameworkBundle\Test\MailerAssertionsTrait;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * Réinitialisation de mot de passe oublié.
 *
 * Avant ce flux, un mot de passe perdu rendait le compte définitivement inaccessible :
 * aucune occurrence de « reset » ou « forgot » dans le contrat, et aucun moyen de
 * changer un mot de passe sans déjà pouvoir se connecter.
 */
final class PasswordResetTest extends ApiTestCase
{
    use MailerAssertionsTrait;

    private const JSON = ['headers' => ['Content-Type' => 'application/json']];

    private function forgot(string $email): void
    {
        $this->client()->request('POST', '/api/password/forgot', self::JSON + ['json' => ['email' => $email]]);
    }

    /**
     * Émet un jeton comme le ferait l'endpoint, et renvoie sa valeur brute.
     */
    private function issueTokenFor(User $user): string
    {
        $raw = bin2hex(random_bytes(32));

        $this->em()->persist(new PasswordResetToken(
            $this->reattach($user),
            PasswordResetService::hash($raw),
            new \DateTimeImmutable('+1 hour'),
        ));
        $this->em()->flush();

        return $raw;
    }

    public function testAKnownAddressReceivesALink(): void
    {
        $this->createUser('oubli@example.com', 'oubli');

        $this->forgot('oubli@example.com');

        self::assertResponseStatusCodeSame(204);
        // `assertQueuedEmailCount` et non `assertEmailCount` : le message est confié
        // à Messenger, pas expédié dans la requête. Voir le test dédié plus bas.
        self::assertQueuedEmailCount(1);

        $message = self::getMailerMessage();
        self::assertNotNull($message);
        self::assertStringContainsString('/password/reset?token=', (string) $message->getHtmlBody());
    }

    /**
     * Le point crucial : répondre 404 sur une adresse absente ferait de cet endpoint
     * un oracle d'énumération des comptes du site.
     */
    public function testAnUnknownAddressGetsTheExactSameAnswer(): void
    {
        $this->forgot('personne@example.com');

        self::assertResponseStatusCodeSame(204);
        self::assertSame('', (string) self::getClient()->getResponse()->getContent());
        self::assertQueuedEmailCount(0, message: 'Aucun message ne doit partir vers une adresse inconnue.');
    }

    public function testAMalformedAddressIsRejected(): void
    {
        $this->forgot('pas-une-adresse');

        self::assertResponseStatusCodeSame(422);
    }

    /**
     * Le jeton n'existe en clair que dans l'e-mail. Une base volée ne doit livrer
     * aucune clé utilisable.
     */
    public function testTheTokenIsNeverStoredInClear(): void
    {
        $user = $this->createUser('empreinte@example.com', 'empreinte');
        $raw = $this->issueTokenFor($user);

        $stored = $this->em()->getRepository(PasswordResetToken::class)->findOneBy([]);
        self::assertNotNull($stored);
        self::assertNotSame($raw, $stored->getTokenHash());
        self::assertSame(hash('sha256', $raw), $stored->getTokenHash());
    }

    public function testTheTokenSetsTheNewPassword(): void
    {
        $user = $this->createUser('nouveau@example.com', 'nouveau');
        $raw = $this->issueTokenFor($user);

        $this->client()->request('POST', '/api/password/reset', self::JSON + [
            'json' => ['token' => $raw, 'plainPassword' => 'nouveaumotdepasse'],
        ]);

        self::assertResponseStatusCodeSame(204);

        // Le nouveau mot de passe ouvre réellement une session.
        $this->client()->request('POST', '/api/login', self::JSON + [
            'json' => ['email' => 'nouveau@example.com', 'password' => 'nouveaumotdepasse'],
        ]);
        self::assertResponseIsSuccessful();
    }

    public function testTheTokenIsSingleUse(): void
    {
        $user = $this->createUser('unique@example.com', 'unique');
        $raw = $this->issueTokenFor($user);

        $this->client()->request('POST', '/api/password/reset', self::JSON + [
            'json' => ['token' => $raw, 'plainPassword' => 'premiermotdepasse'],
        ]);
        self::assertResponseStatusCodeSame(204);

        $this->client()->request('POST', '/api/password/reset', self::JSON + [
            'json' => ['token' => $raw, 'plainPassword' => 'secondmotdepasse'],
        ]);
        self::assertResponseStatusCodeSame(422);

        // Et le second mot de passe n'a pas pris.
        $this->client()->request('POST', '/api/login', self::JSON + [
            'json' => ['email' => 'unique@example.com', 'password' => 'secondmotdepasse'],
        ]);
        self::assertResponseStatusCodeSame(401);
    }

    public function testAnExpiredTokenIsRefused(): void
    {
        $user = $this->createUser('perime@example.com', 'perime');
        $raw = bin2hex(random_bytes(32));

        $this->em()->persist(new PasswordResetToken(
            $this->reattach($user),
            PasswordResetService::hash($raw),
            new \DateTimeImmutable('-1 minute'),
        ));
        $this->em()->flush();

        $this->client()->request('POST', '/api/password/reset', self::JSON + [
            'json' => ['token' => $raw, 'plainPassword' => 'peuimporte12'],
        ]);

        self::assertResponseStatusCodeSame(422);
    }

    public function testAnInventedTokenIsRefused(): void
    {
        $this->client()->request('POST', '/api/password/reset', self::JSON + [
            'json' => ['token' => 'jeton-invente', 'plainPassword' => 'peuimporte12'],
        ]);

        self::assertResponseStatusCodeSame(422);
    }

    /**
     * Une nouvelle demande périme la précédente : sinon chaque clic sur « mot de passe
     * oublié » laisserait derrière lui une clé valide une heure durant.
     */
    public function testANewRequestInvalidatesTheOldLink(): void
    {
        $user = $this->createUser('empile@example.com', 'empile');
        $premier = $this->issueTokenFor($user);

        $this->forgot('empile@example.com');
        self::assertResponseStatusCodeSame(204);

        $this->client()->request('POST', '/api/password/reset', self::JSON + [
            'json' => ['token' => $premier, 'plainPassword' => 'peuimporte12'],
        ]);
        self::assertResponseStatusCodeSame(422);
    }

    /**
     * Le lien demandé AVANT un changement de mot de passe ne doit plus fonctionner
     * APRÈS : c'est exactement ainsi qu'on reprendrait la main sur un compte dont le
     * propriétaire vient d'en sécuriser l'accès.
     */
    public function testChangingThePasswordInvalidatesPendingLinks(): void
    {
        $user = $this->createUser('durci@example.com', 'durci');
        $raw = $this->issueTokenFor($user);

        $this->client($this->tokenFor($this->reattach($user)))->request('PATCH', '/api/users/'.$user->getId(), [
            'headers' => ['Content-Type' => 'application/merge-patch+json'],
            'json' => ['currentPassword' => 'motdepasse1', 'plainPassword' => 'motdepasse2'],
        ]);
        self::assertResponseIsSuccessful();

        $this->client()->request('POST', '/api/password/reset', self::JSON + [
            'json' => ['token' => $raw, 'plainPassword' => 'motdepasse3'],
        ]);
        self::assertResponseStatusCodeSame(422);
    }

    /**
     * Le message part par Messenger : la requête HTTP ne doit pas attendre le serveur
     * SMTP, dont la lenteur trahirait au passage l'existence du compte.
     */
    public function testTheEmailIsQueuedAndNotSentInline(): void
    {
        $this->createVerifiedUserAndForget();

        self::assertQueuedEmailCount(1);
        // Aucun message n'est parti en ligne : `assertEmailCount` ne compte que les
        // envois synchrones. Si cette assertion tombe, c'est que le routage Messenger
        // de SendEmailMessage a sauté et que la requête HTTP attend de nouveau le SMTP.
        self::assertEmailCount(0);
    }

    private function createVerifiedUserAndForget(): void
    {
        $this->createUser('file@example.com', 'file');
        $this->forgot('file@example.com');
    }

    /**
     * Le mot de passe posé par le flux de réinitialisation doit obéir aux mêmes règles
     * de robustesse que partout ailleurs.
     */
    public function testAShortPasswordIsRefused(): void
    {
        $user = $this->createUser('court@example.com', 'court');
        $raw = $this->issueTokenFor($user);

        $this->client()->request('POST', '/api/password/reset', self::JSON + [
            'json' => ['token' => $raw, 'plainPassword' => 'court'],
        ]);

        self::assertResponseStatusCodeSame(422);
    }

    public function testThePasswordEndpointsAreThrottled(): void
    {
        $codes = [];

        for ($i = 0; $i < 6; ++$i) {
            $this->forgot('inconnu@example.com');
            $codes[] = self::getClient()->getResponse()->getStatusCode();
        }

        self::assertSame([204, 204, 204, 204, 204, 429], $codes);
    }

    /**
     * Le quota par ADRESSE ne change pas le statut renvoyé — il coupe seulement
     * l'envoi. Un 429 ici distinguerait une adresse déjà sollicitée d'une adresse
     * inconnue, et rendrait à l'endpoint son rôle d'oracle.
     */
    public function testThePerAddressQuotaSilencesTheMailWithoutChangingTheAnswer(): void
    {
        $this->createUser('insistant@example.com', 'insistant');

        $codes = [];
        $envoyes = 0;

        for ($i = 0; $i < 5; ++$i) {
            $this->forgot('insistant@example.com');
            $codes[] = self::getClient()->getResponse()->getStatusCode();
            // Compté requête par requête : chaque `client()` redémarre le noyau, donc
            // le journal du mailer ne retient que le dernier échange.
            $envoyes += \count(self::getMailerEvents());
        }

        // Le 6e appel serait coupé par le quota IP ; les 5 premiers passent tous.
        self::assertSame([204, 204, 204, 204, 204], $codes);
        self::assertSame(3, $envoyes, 'Le quota par adresse est de 3 messages par heure.');
    }

    /**
     * Durcissement lié : sans le mot de passe courant, un JWT volé suffisait à changer
     * le mot de passe et à verrouiller le propriétaire hors de son compte.
     */
    public function testChangingOnesPasswordRequiresTheCurrentOne(): void
    {
        $user = $this->createUser('vole@example.com', 'vole');

        $this->client($this->tokenFor($this->reattach($user)))->request('PATCH', '/api/users/'.$user->getId(), [
            'headers' => ['Content-Type' => 'application/merge-patch+json'],
            'json' => ['plainPassword' => 'motdepasseusurpe'],
        ]);

        self::assertResponseStatusCodeSame(422);
        self::assertStringContainsString('currentPassword', (string) self::getClient()->getResponse()->getContent());

        // Le mot de passe d'origine fonctionne toujours.
        $this->client()->request('POST', '/api/login', self::JSON + [
            'json' => ['email' => 'vole@example.com', 'password' => 'motdepasse1'],
        ]);
        self::assertResponseIsSuccessful();
    }

    public function testAWrongCurrentPasswordIsRefused(): void
    {
        $user = $this->createUser('faux@example.com', 'faux');

        $this->client($this->tokenFor($this->reattach($user)))->request('PATCH', '/api/users/'.$user->getId(), [
            'headers' => ['Content-Type' => 'application/merge-patch+json'],
            'json' => ['currentPassword' => 'pas-le-bon', 'plainPassword' => 'motdepasse2'],
        ]);

        self::assertResponseStatusCodeSame(422);
    }

    /**
     * La règle ne doit pas gêner les modifications qui ne touchent pas au mot de passe.
     */
    public function testAProfileUpdateWithoutPasswordChangeIsUntouched(): void
    {
        $user = $this->createUser('profil@example.com', 'profil');

        $this->client($this->tokenFor($this->reattach($user)))->request('PATCH', '/api/users/'.$user->getId(), [
            'headers' => ['Content-Type' => 'application/merge-patch+json'],
            'json' => ['username' => 'profil-renomme'],
        ]);

        self::assertResponseIsSuccessful();
    }

    public function testTheCurrentPasswordIsNeverSerialized(): void
    {
        $user = $this->createUser('discret@example.com', 'discret');

        $this->client($this->tokenFor($this->reattach($user)))->request('PATCH', '/api/users/'.$user->getId(), [
            'headers' => ['Content-Type' => 'application/merge-patch+json'],
            'json' => ['currentPassword' => 'motdepasse1', 'plainPassword' => 'motdepasse2'],
        ]);

        self::assertResponseIsSuccessful();
        $body = (string) self::getClient()->getResponse()->getContent();
        self::assertStringNotContainsString('motdepasse1', $body);
        self::assertStringNotContainsString('motdepasse2', $body);
        self::assertStringNotContainsString('currentPassword', $body);
    }

    /**
     * Un administrateur ne connaît pas le mot de passe des comptes qu'il administre :
     * lui imposer la règle reviendrait à supprimer l'intervention plutôt qu'à la
     * sécuriser.
     */
    public function testAnAdminActingOnAnotherAccountIsExempt(): void
    {
        $cible = $this->createUser('cible-admin@example.com', 'cibleadmin');
        $admin = $this->createUser('patron@example.com', 'patron', admin: true);

        $this->client($this->tokenFor($this->reattach($admin)))->request('PATCH', '/api/users/'.$cible->getId(), [
            'headers' => ['Content-Type' => 'application/merge-patch+json'],
            'json' => ['plainPassword' => 'motdepasseadmin'],
        ]);

        self::assertResponseIsSuccessful();
    }

    /**
     * L'inscription ne peut évidemment pas exiger un mot de passe courant.
     */
    public function testRegistrationIsUnaffected(): void
    {
        $this->client()->request('POST', '/api/register', [
            'headers' => ['Content-Type' => 'application/ld+json'],
            'json' => ['email' => 'neuf@example.com', 'username' => 'neuf', 'plainPassword' => 'motdepasse1'],
        ]);

        self::assertResponseStatusCodeSame(201);

        $created = $this->em()->getRepository(User::class)->findOneBy(['email' => 'neuf@example.com']);
        self::assertNotNull($created);
        self::assertTrue(
            self::getContainer()->get(UserPasswordHasherInterface::class)->isPasswordValid($created, 'motdepasse1'),
        );
    }
}
