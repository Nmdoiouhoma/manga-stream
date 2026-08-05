<?php

declare(strict_types=1);

namespace App\Service\Comment;

use App\Entity\Comment;
use Psr\Log\LoggerInterface;
use Symfony\Component\Mercure\HubInterface;
use Symfony\Component\Mercure\Update;
use Symfony\Component\Serializer\SerializerInterface;

/**
 * Annonce sur le fil d'une œuvre qu'un commentaire vient d'y être posté.
 *
 * ── Ce que ce service n'est pas ───────────────────────────────────────────────
 * Ce n'est **pas** une notification : rien n'est écrit en base, aucun compteur de
 * non-lus ne bouge, personne n'est « prévenu ». C'est un simple signal à
 * destination des navigateurs qui regardent la fiche à cet instant, pour qu'ils
 * rafraîchissent le fil. Un client déconnecté ne perd rien — il verra le
 * commentaire à son prochain chargement, l'API restant la seule source de vérité.
 *
 * D'où l'absence de persistance, contrairement à {@see \App\Service\Notification\Notifier}
 * qui, lui, doit survivre à un onglet fermé.
 *
 * ── Échec silencieux, comme le Notifier ───────────────────────────────────────
 * Un hub indisponible ne doit jamais faire échouer le POST du commentaire :
 * l'utilisateur a écrit son message, il est enregistré, le reste est du confort.
 */
final class CommentBroadcaster
{
    public function __construct(
        private readonly HubInterface $hub,
        private readonly SerializerInterface $serializer,
        private readonly LoggerInterface $logger,
    ) {
    }

    public function broadcast(Comment $comment): void
    {
        $topic = CommentTopics::forComment($comment);

        if (null === $topic || null === $comment->getId()) {
            return;
        }

        try {
            $data = $this->serializer->serialize($comment, 'jsonld', [
                'groups' => ['comment:read'],
            ]);

            $this->hub->publish(new Update(
                topics: $topic,
                data: $data,
                // Public, et c'est le but : le fil est partagé, le jeton abonné de
                // chaque client ne porte que son topic personnel. Voir la
                // justification complète dans {@see CommentTopics}.
                private: false,
            ));
        } catch (\Throwable $e) {
            $this->logger->error('Mercure : diffusion du commentaire impossible.', [
                'comment' => $comment->getId(),
                'topic' => $topic,
                'error' => $e->getMessage(),
            ]);
        }
    }
}
