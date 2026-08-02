<?php

declare(strict_types=1);

namespace App\Service\Security;

use App\Entity\PasswordResetToken;
use App\Entity\User;
use App\Repository\PasswordResetTokenRepository;
use App\Repository\UserRepository;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Log\LoggerInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;
use Symfony\Component\RateLimiter\RateLimiterFactoryInterface;

/**
 * Émission et consommation des jetons de réinitialisation.
 *
 * Toute la logique sensible est ici, pas dans les processors : les deux endpoints s'y
 * ramènent, et la commande console éventuelle aussi.
 */
final readonly class PasswordResetService
{
    /**
     * Une heure. Assez long pour survivre à une boîte mail lente ou consultée en
     * différé, assez court pour qu'un lien qui traîne dans un historique de
     * navigateur ou une boîte partagée cesse vite d'être une clé du compte.
     */
    public const TTL = 'PT1H';

    public function __construct(
        private EntityManagerInterface $entityManager,
        private UserRepository $users,
        private PasswordResetTokenRepository $tokens,
        private UserPasswordHasherInterface $passwordHasher,
        private PasswordResetMailer $mailer,
        #[Autowire(service: 'limiter.password_reset_email')]
        private RateLimiterFactoryInterface $perEmailLimiter,
        private LoggerInterface $logger,
    ) {
    }

    /**
     * Traite une demande d'oubli. Ne renvoie RIEN, dans tous les cas de figure.
     *
     * Adresse inconnue, quota atteint, envoi impossible : l'appelant ne fait aucune
     * différence, et c'est le but. La moindre variation observable — statut, délai de
     * réponse, message — redonnerait à l'endpoint le rôle d'oracle d'énumération que
     * son 204 systématique lui retire.
     */
    public function request(string $email): void
    {
        // Le compteur par adresse est consommé AVANT la recherche en base, donc de la
        // même manière pour une adresse existante et pour une adresse inventée. Le
        // consommer seulement en cas de succès créerait une différence de temps de
        // réponse mesurable, et l'oracle reviendrait par la petite porte.
        $withinQuota = $this->perEmailLimiter->create(hash('sha256', mb_strtolower($email)))->consume()->isAccepted();

        $user = $this->users->findOneBy(['email' => $email]);

        if (!$user instanceof User) {
            return;
        }

        if (!$withinQuota) {
            // Silencieux côté client, tracé côté serveur : sans cette ligne, une
            // rafale d'e-mails bloquée ressemblerait à un envoi qui échoue.
            $this->logger->notice('Réinitialisation de mot de passe : quota par adresse atteint, aucun e-mail envoyé.');

            return;
        }

        $now = new \DateTimeImmutable();

        // Une seule réinitialisation en vol à la fois : demander un nouveau lien
        // périme le précédent. Sinon chaque demande laisserait derrière elle une clé
        // valide pendant une heure, et il suffirait d'en accumuler.
        $this->tokens->invalidateAllFor($user, $now);

        $rawToken = bin2hex(random_bytes(32));

        $this->entityManager->persist(new PasswordResetToken(
            $user,
            self::hash($rawToken),
            $now->add(new \DateInterval(self::TTL)),
        ));
        $this->entityManager->flush();

        $this->mailer->send($user, $rawToken, $now->add(new \DateInterval(self::TTL)));
    }

    /**
     * Consomme un jeton et pose le nouveau mot de passe.
     *
     * @return bool false si le jeton est inconnu, expiré ou déjà utilisé — sans dire
     *              lequel des trois : le distinguer renseignerait un attaquant sur
     *              l'état des jetons en circulation
     */
    public function reset(string $rawToken, string $plainPassword): bool
    {
        $token = $this->tokens->findOneByHash(self::hash($rawToken));
        $now = new \DateTimeImmutable();

        if (null === $token || !$token->isUsable($now)) {
            return false;
        }

        $user = $token->getUser();
        $user->setPassword($this->passwordHasher->hashPassword($user, $plainPassword));

        $token->markUsed($now);
        // Et tous les autres avec : à ce stade le compte est repris en main, aucun
        // lien émis auparavant ne doit plus fonctionner.
        $this->tokens->invalidateAllFor($user, $now);

        $this->entityManager->flush();

        return true;
    }

    /**
     * Empreinte stockée en base. Voir {@see PasswordResetToken} pour le choix de
     * SHA-256 nu plutôt qu'un hachage lent.
     */
    public static function hash(string $rawToken): string
    {
        return hash('sha256', $rawToken);
    }
}
