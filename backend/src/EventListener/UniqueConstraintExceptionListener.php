<?php

declare(strict_types=1);

namespace App\EventListener;

use Doctrine\DBAL\Exception\UniqueConstraintViolationException;
use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Event\ExceptionEvent;

/**
 * Traduit une violation d'index unique en 409, sans jamais laisser filtrer de SQL.
 *
 * Les doublons prévisibles sont interceptés en amont par les contraintes
 * `UniqueEntity` (réponse 422 détaillée). Restent les courses : deux requêtes
 * simultanées passent toutes deux la validation, et c'est la base qui tranche. Sans ce
 * listener, le client recevait un HTTP 500 exposant le message Doctrine brut
 * (« SQLSTATE[23505] ... uniq_favorite_user_anime »), c'est-à-dire le nom des tables
 * et des index — une fuite d'information autant qu'un mauvais code de statut.
 */
#[AsEventListener(event: 'kernel.exception', priority: 100)]
final readonly class UniqueConstraintExceptionListener
{
    public function __invoke(ExceptionEvent $event): void
    {
        $exception = $event->getThrowable();

        while (null !== $exception && !$exception instanceof UniqueConstraintViolationException) {
            $exception = $exception->getPrevious();
        }

        if (!$exception instanceof UniqueConstraintViolationException) {
            return;
        }

        if (!str_starts_with($event->getRequest()->getPathInfo(), '/api')) {
            return;
        }

        $event->setResponse(new JsonResponse(
            [
                'type' => 'https://tools.ietf.org/html/rfc2616#section-10',
                'title' => 'Conflit',
                'status' => Response::HTTP_CONFLICT,
                'detail' => 'Cette ressource existe déjà.',
            ],
            Response::HTTP_CONFLICT,
            ['Content-Type' => 'application/problem+json; charset=utf-8'],
        ));
    }
}
