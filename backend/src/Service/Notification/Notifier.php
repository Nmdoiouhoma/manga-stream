<?php

declare(strict_types=1);

namespace App\Service\Notification;

use App\Entity\Notification;
use App\Entity\User;
use App\Enum\NotificationType;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Log\LoggerInterface;
use Symfony\Component\Mercure\HubInterface;
use Symfony\Component\Mercure\Update;
use Symfony\Component\Serializer\SerializerInterface;

/**
 * Enregistre une notification **et** la pousse en temps réel.
 *
 * Les deux ne sont pas redondants : la ligne en base est l'historique, qui survit à
 * une déconnexion ou à un onglet fermé ; l'update Mercure n'est qu'un raccourci pour
 * les clients connectés à l'instant T. C'est la base qui fait foi — si la publication
 * échoue (hub indisponible), la notification reste consultable via
 * `GET /api/notifications`, et l'échec ne fait pas remonter d'exception dans le flux
 * appelant : perdre une notification temps réel ne doit jamais faire échouer la
 * requête HTTP ou le worker qui l'a déclenchée.
 *
 * ⚠️ Toutes les publications sont **privées** (`private: true`). Voir
 * {@see NotificationTopics} pour le raisonnement complet : restreindre les
 * abonnements ne cloisonne rien tant que les updates partent en public.
 */
final class Notifier
{
    public function __construct(
        private readonly HubInterface $hub,
        private readonly EntityManagerInterface $entityManager,
        private readonly SerializerInterface $serializer,
        private readonly LoggerInterface $logger,
    ) {
    }

    /**
     * @param array<string, mixed> $payload
     */
    public function notify(User $user, NotificationType $type, array $payload): Notification
    {
        $notification = (new Notification())
            ->setUser($user)
            ->setType($type)
            ->setPayload($payload);

        $this->entityManager->persist($notification);
        $this->entityManager->flush();

        $this->publish($notification);

        return $notification;
    }

    /**
     * Notifie plusieurs destinataires en une seule transaction.
     *
     * @param iterable<User>       $users
     * @param array<string, mixed> $payload
     *
     * @return int nombre de notifications créées
     */
    public function notifyAll(iterable $users, NotificationType $type, array $payload): int
    {
        $notifications = [];

        foreach ($users as $user) {
            $notification = (new Notification())
                ->setUser($user)
                ->setType($type)
                ->setPayload($payload);

            $this->entityManager->persist($notification);
            $notifications[] = $notification;
        }

        if ([] === $notifications) {
            return 0;
        }

        $this->entityManager->flush();

        foreach ($notifications as $notification) {
            $this->publish($notification);
        }

        return \count($notifications);
    }

    /**
     * Pousse la notification sur le topic personnel de son destinataire.
     *
     * Le corps publié est la **représentation JSON-LD de la ressource**, identique à
     * celle de `GET /api/notifications/{id}` : le client réutilise tel quel le type
     * généré depuis le contrat, sans schéma parallèle à maintenir.
     */
    private function publish(Notification $notification): void
    {
        $user = $notification->getUser();

        if (null === $user || null === $user->getId()) {
            return;
        }

        try {
            $data = $this->serializer->serialize($notification, 'jsonld', [
                'groups' => ['notification:read'],
            ]);

            $this->hub->publish(new Update(
                topics: NotificationTopics::forUser($user),
                data: $data,
                // Non négociable : une update publique est diffusée à tous les abonnés
                // du topic, y compris ceux dont le JWT ne le mentionne pas.
                private: true,
            ));
        } catch (\Throwable $e) {
            $this->logger->error('Mercure : publication de la notification impossible.', [
                'notification' => $notification->getId(),
                'type' => $notification->getType()->value,
                'error' => $e->getMessage(),
            ]);
        }
    }
}
