<?php

declare(strict_types=1);

namespace App\Security;

use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;

/**
 * Fabrique les réponses 429 de l'API.
 *
 * Un 429 sans `Retry-After` est un 429 à moitié utile : le client n'a plus qu'à
 * réessayer au hasard, ce qui aggrave la charge au lieu de la réduire. L'en-tête est
 * donc systématique, en secondes.
 *
 * Deux formes de corps, et ce n'est pas une incohérence : `POST /api/login` est servi
 * par lexik/jwt-authentication-bundle, dont les erreurs ont toujours la forme
 * `{code, message}` — c'est ce que le contrat documente pour son 401 et ce que le
 * frontend sait déjà lire. Le reste de l'API répond en `application/problem+json`
 * comme toutes les erreurs API Platform. Chaque endpoint conserve donc SA forme
 * d'erreur, plutôt que d'en introduire une troisième pour le seul cas du 429.
 */
final class ThrottleResponse
{
    /**
     * Forme API Platform (RFC 7807), pour tout ce qui n'est pas la connexion.
     */
    public static function problem(int $retryAfter, string $detail): JsonResponse
    {
        return self::withRetryAfter(new JsonResponse([
            'type' => 'https://tools.ietf.org/html/rfc6585#section-4',
            'title' => 'An error occurred',
            'status' => Response::HTTP_TOO_MANY_REQUESTS,
            'detail' => $detail,
        ], Response::HTTP_TOO_MANY_REQUESTS, ['Content-Type' => 'application/problem+json; charset=utf-8']), $retryAfter);
    }

    /**
     * Forme lexik `{code, message}`, pour `POST /api/login`.
     */
    public static function login(int $retryAfter, string $message): JsonResponse
    {
        return self::withRetryAfter(new JsonResponse([
            'code' => Response::HTTP_TOO_MANY_REQUESTS,
            'message' => $message,
        ], Response::HTTP_TOO_MANY_REQUESTS), $retryAfter);
    }

    private static function withRetryAfter(JsonResponse $response, int $retryAfter): JsonResponse
    {
        $response->headers->set('Retry-After', (string) max(1, $retryAfter));

        return $response;
    }
}
