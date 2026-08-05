<?php

declare(strict_types=1);

namespace App\State;

use ApiPlatform\Metadata\IriConverterInterface;
use ApiPlatform\Metadata\Operation;
use ApiPlatform\State\ProcessorInterface;
use App\Entity\Comment;
use App\Enum\NotificationType;
use App\Service\Comment\CommentBroadcaster;
use App\Service\Notification\Notifier;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Effets de bord de la création d'un commentaire.
 *
 * Branché sur le seul `POST /api/comments` : une modification ultérieure du contenu ne
 * doit ni renotifier ni rediffuser, et une suppression encore moins.
 *
 * Deux effets, à ne pas confondre — ils n'ont ni le même public ni la même portée :
 *
 *  1. **diffusion sur le fil** ({@see CommentBroadcaster}) — pour *tout* commentaire,
 *     racine comme réponse. Elle prévient les navigateurs ouverts sur la fiche que le
 *     fil a bougé. Rien n'est persisté : c'est du confort d'affichage ;
 *  2. **notification de réponse** ({@see Notifier}) — pour le seul auteur du
 *     commentaire auquel on répond. Elle est persistée, alimente la cloche et survit à
 *     un onglet fermé.
 *
 * Deux cas ne notifient rien, volontairement (mais diffusent quand même, cf. 1) :
 *  - le commentaire n'est pas une réponse (`parent` absent) — personne n'est
 *    destinataire ;
 *  - l'auteur se répond à lui-même — se notifier soi-même n'a aucun intérêt et
 *    gonflerait le compteur de non-lus à chaque fil qu'on alimente.
 *
 * Les deux effets sont émis **après** la persistance : ils référencent l'IRI du
 * commentaire, qui n'existe pas tant que l'identifiant n'a pas été attribué.
 *
 * @implements ProcessorInterface<Comment, Comment>
 */
final readonly class CommentCreationProcessor implements ProcessorInterface
{
    public function __construct(
        #[Autowire(service: 'api_platform.doctrine.orm.state.persist_processor')]
        private ProcessorInterface $persistProcessor,
        private Notifier $notifier,
        private CommentBroadcaster $broadcaster,
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

        // Avant l'aiguillage sur `parent` : un commentaire racine ne notifie personne,
        // mais doit apparaître chez ceux qui regardent la fiche. C'était le trou —
        // seul le destinataire d'une réponse voyait son fil bouger.
        $this->broadcaster->broadcast($comment);

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
