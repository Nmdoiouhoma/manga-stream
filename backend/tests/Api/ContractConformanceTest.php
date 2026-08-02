<?php

declare(strict_types=1);

namespace App\Tests\Api;

use App\Entity\Comment;

/**
 * Écarts entre le contrat OpenAPI et le comportement réel, relevés par le frontend.
 *
 * Chacun de ces tests ancre une correction : ce sont des régressions silencieuses,
 * qu'aucune erreur serveur ne signale — seul un client généré depuis le contrat
 * s'en aperçoit, et souvent trop tard.
 */
final class ContractConformanceTest extends ApiTestCase
{
    /**
     * `GET /api/me` renvoyait `"@id": "/api/me"`, l'IRI de l'opération et non celle du
     * compte. Or le frontend récupère précisément cette valeur pour la renvoyer en
     * `Favorite.user` ou `Progress.user` — et `/api/me` n'y est pas une référence
     * valide.
     */
    public function testMeReturnsTheCanonicalUserIri(): void
    {
        $user = $this->createUser('canonique@example.com', 'canonique');
        $userId = (int) $user->getId();

        $response = $this->client($this->tokenFor($user))->request('GET', '/api/me');

        self::assertResponseIsSuccessful();
        self::assertSame('/api/users/'.$userId, $response->toArray()['@id']);
    }

    /**
     * L'IRI renvoyée par `/api/me` doit être directement réutilisable en écriture.
     */
    public function testTheIriFromMeIsUsableAsARelation(): void
    {
        $user = $this->createUser('reutilisable@example.com', 'reutilisable');
        $anime = $this->createAnime('Cible');

        $iri = $this->client($this->tokenFor($user))->request('GET', '/api/me')->toArray()['@id'];

        $this->client($this->tokenFor($this->reattach($user)))->request('POST', '/api/favorites', [
            'headers' => ['Content-Type' => 'application/ld+json'],
            'json' => ['user' => $iri, 'anime' => '/api/animes/'.$anime->getId()],
        ]);

        self::assertResponseStatusCodeSame(201);
    }

    /**
     * `Comment.parent` était décrit dans le contrat comme un objet Comment imbriqué,
     * contrairement à toutes les autres relations. L'API a toujours accepté et renvoyé
     * une IRI : c'est le contrat qui mentait.
     */
    public function testCommentParentIsSerializedAsAnIri(): void
    {
        $user = $this->createUser('fil@example.com', 'fil');
        $anime = $this->createAnime('Fil de discussion');

        $parent = new Comment();
        $parent->setUser($this->reattach($user))->setAnime($anime)->setContent('Racine.');
        $this->em()->persist($parent);
        $this->em()->flush();

        $parentIri = '/api/comments/'.$parent->getId();

        $response = $this->client($this->tokenFor($this->reattach($user)))->request('POST', '/api/comments', [
            'headers' => ['Content-Type' => 'application/ld+json'],
            'json' => [
                'content' => 'Réponse.',
                'anime' => '/api/animes/'.$anime->getId(),
                'parent' => $parentIri,
            ],
        ]);

        self::assertResponseStatusCodeSame(201);

        $body = $response->toArray();
        self::assertIsString($body['parent'], 'parent doit être une IRI, pas un objet imbriqué.');
        self::assertSame($parentIri, $body['parent']);
    }

    /**
     * Le contrat ne documentait que le `200` de `POST /api/login`, ce qui faisait typer
     * `error` en `never` chez openapi-fetch : le client était obligé de lire le statut
     * sur l'objet `Response`.
     */
    public function testTheLoginContractDocumentsItsErrors(): void
    {
        $openApi = $this->client()->request('GET', '/api/docs.jsonopenapi', [
            'headers' => ['Accept' => 'application/vnd.openapi+json'],
        ])->toArray();

        $responses = $openApi['paths']['/api/login']['post']['responses'];

        self::assertArrayHasKey('200', $responses);
        self::assertArrayHasKey('401', $responses);
        self::assertArrayHasKey('400', $responses);

        $unauthorized = $responses['401']['content']['application/json']['schema']['properties'];
        self::assertSame(['code', 'message'], array_keys($unauthorized));

        self::assertArrayHasKey(
            'mercure',
            $responses['200']['content']['application/json']['schema']['properties'],
            'La réponse de connexion porte l\'abonnement Mercure : le contrat doit le dire.',
        );
    }

    /**
     * Les statuts documentés doivent correspondre à ce que le serveur renvoie vraiment.
     */
    public function testLoginFailuresMatchTheDocumentedStatuses(): void
    {
        $this->createUser('reel@example.com', 'reel');

        $this->client()->request('POST', '/api/login', [
            'headers' => ['Content-Type' => 'application/json'],
            'json' => ['email' => 'reel@example.com', 'password' => 'mauvais'],
        ]);
        self::assertResponseStatusCodeSame(401);

        $this->client()->request('POST', '/api/login', [
            'headers' => ['Content-Type' => 'application/json'],
            'json' => ['email' => 'reel@example.com'],
        ]);
        self::assertResponseStatusCodeSame(400);
    }

    /**
     * Le contrat doit exposer l'endpoint d'abonnement Mercure, sans quoi le frontend
     * n'a aucun type généré pour l'appeler.
     */
    public function testTheMercureSubscriptionEndpointIsDocumented(): void
    {
        $openApi = $this->client()->request('GET', '/api/docs.jsonopenapi', [
            'headers' => ['Accept' => 'application/vnd.openapi+json'],
        ])->toArray();

        self::assertArrayHasKey('/api/mercure/subscription', $openApi['paths']);
    }
}
