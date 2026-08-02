<?php

declare(strict_types=1);

namespace App\Service\Security;

use App\Entity\User;
use Psr\Log\LoggerInterface;
use Symfony\Bridge\Twig\Mime\TemplatedEmail;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\Mailer\Exception\TransportExceptionInterface;
use Symfony\Component\Mailer\MailerInterface;

/**
 * Expédie le message de réinitialisation.
 *
 * L'envoi passe par Messenger — `SendEmailMessage` est routé sur le transport `async`
 * (config/packages/messenger.yaml) et traité par le worker déjà en place. La requête
 * HTTP ne dépend donc pas du serveur SMTP : un relais lent ou injoignable ne se
 * traduit pas par une requête qui pend, et le temps de réponse ne varie pas selon que
 * l'adresse existe ou non — ce qui compte ici, puisque tout l'endpoint est construit
 * pour ne rien laisser filtrer.
 *
 * Contrepartie assumée : le jeton BRUT transite par la file, donc par la table
 * `messenger_messages`, le temps que le worker traite le message. C'est inévitable —
 * il faut bien que la valeur en clair atteigne l'e-mail — mais cela veut dire que la
 * file mérite le même soin que la table des jetons : accès restreint, et purge des
 * messages traités (ce que fait Messenger par défaut).
 */
final readonly class PasswordResetMailer
{
    public function __construct(
        private MailerInterface $mailer,
        private LoggerInterface $logger,
        /**
         * Base des liens envoyés à l'utilisateur : c'est le FRONTEND qui sert
         * `/password/reset`, pas l'API. Pointer sur l'API donnerait un lien mort.
         */
        #[Autowire('%app.frontend_url%')]
        private string $frontendUrl,
    ) {
    }

    public function send(User $user, string $rawToken, \DateTimeImmutable $expiresAt): void
    {
        $email = (new TemplatedEmail())
            ->to($user->getEmail())
            ->subject('Réinitialisation de votre mot de passe Manga Stream')
            ->htmlTemplate('emails/password_reset.html.twig')
            ->textTemplate('emails/password_reset.txt.twig')
            ->context([
                'username' => $user->getUsername(),
                'resetUrl' => \sprintf(
                    '%s/password/reset?token=%s',
                    rtrim($this->frontendUrl, '/'),
                    urlencode($rawToken),
                ),
                'expiresAt' => $expiresAt,
            ]);

        try {
            $this->mailer->send($email);
        } catch (TransportExceptionInterface $exception) {
            // Une panne d'envoi ne doit pas remonter jusqu'au client : elle
            // transformerait le 204 en 500 pour les seules adresses existantes, ce qui
            // rétablirait exactement l'oracle qu'on cherche à supprimer.
            $this->logger->error('Envoi du message de réinitialisation impossible.', ['exception' => $exception]);
        }
    }
}
