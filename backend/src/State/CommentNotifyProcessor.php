<?php

declare(strict_types=1);

namespace App\State;

use ApiPlatform\Metadata\IriConverterInterface;
use ApiPlatform\Metadata\Operation;
use ApiPlatform\State\ProcessorInterface;
use App\Entity\Comment;
use App\Enum\NotificationType;
use App\Service\Notification\Notifier;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Prévient l'auteur d'un commentaire lorsqu'on lui répond.
 *
 * Branché sur le seul `POST /api/comments` : une modification ultérieure du contenu ne
 * doit pas renotifier, et une suppression encore moins.
 *
 * Deux cas ne déclenchent rien, volontairement :
 *  - le commentaire n'est pas une réponse (`parent` absent) ;
 *  - l'auteur se répond à lui-même — se notifier soi-même n'a aucun intérêt et
 *    gonflerait le compteur de non-lus à chaque fil qu'on alimente.
 *
 * La notification est émise **après** la persistance : elle référence l'IRI du
 * commentaire, qui n'existe pas tant que l'identifiant n'a pas été attribué.
 *
 * @implements ProcessorInterface<Comment, Comment>
 */
final readonly class CommentNotifyProcessor implements ProcessorInterface
{
    public function __construct(
        #[Autowire(service: 'api_platform.doctrine.orm.state.persist_processor')]
        private ProcessorInterface $persistProcessor,
        private Notifier $notifier,
        private IriConverterInterface $iriConverter,
    ) {
    }

    public function process(mixed $data, Operation $operation, array $uriVariables = [], array $context = []): mixed
    {
        /** @var Comment $comment */
        $comment = $this->persistProcessor->process($data, $operation, $uriVariables, $context);

        if (!$comment instanceof Comment) {
            return $comment;
        }

        $parent = $comment->getParent();
        $recipient = $parent?->getUser();
        $author = $comment->getUser();

        if (null === $parent || null === $recipient || $recipient === $author) {
            return $comment;
        }

        $this->notifier->notify($recipient, NotificationType::COMMENT_REPLY, [
            'commentId' => $comment->getId(),
            'commentIri' => $this->iriConverter->getIriFromResource($comment),
            'parentCommentId' => $parent->getId(),
            'parentCommentIri' => $this->iriConverter->getIriFromResource($parent),
            'authorId' => $author?->getId(),
            'authorUsername' => $author?->getUsername(),
            'excerpt' => self::excerpt($comment->getContent()),
        ]);

        return $comment;
    }

    /**
     * Extrait de la réponse, pour afficher la notification sans avoir à recharger le
     * commentaire. Borné : le contenu peut aller jusqu'à 5 000 caractères.
     */
    private static function excerpt(string $content): string
    {
        $content = trim(preg_replace('/\s+/u', ' ', $content) ?? $content);

        return mb_strlen($content) > 140 ? mb_substr($content, 0, 139).'…' : $content;
    }
}
