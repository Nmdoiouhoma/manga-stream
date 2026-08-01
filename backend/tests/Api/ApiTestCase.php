<?php

declare(strict_types=1);

namespace App\Tests\Api;

use ApiPlatform\Symfony\Bundle\Test\ApiTestCase as BaseApiTestCase;
use ApiPlatform\Symfony\Bundle\Test\Client;
use App\Entity\Anime;
use App\Entity\Genre;
use App\Entity\Manga;
use App\Entity\User;
use Doctrine\ORM\EntityManagerInterface;
use Lexik\Bundle\JWTAuthenticationBundle\Services\JWTTokenManagerInterface;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * Socle des tests fonctionnels de l'API.
 *
 * Deux pièges d'infrastructure sont neutralisés ici une bonne fois pour toutes :
 *
 *  - chaque test s'exécute dans une transaction annulée à la fin
 *    (dama/doctrine-test-bundle) : les fixtures sont créées dans le test lui-même et
 *    rien ne fuit d'un test à l'autre ;
 *  - `createClient()` redémarre le noyau, donc l'EntityManager change en cours de
 *    test. On ne mémorise jamais l'instance ({@see self::em()}) et les entités créées
 *    avant une requête sont réattachées au gestionnaire courant
 *    ({@see self::reattach()}) — sans quoi Doctrine les prend pour de nouvelles
 *    entités et refuse de les enregistrer.
 */
abstract class ApiTestCase extends BaseApiTestCase
{
    protected function setUp(): void
    {
        self::bootKernel();
    }

    /**
     * EntityManager du noyau *courant*, jamais mémorisé.
     */
    protected function em(): EntityManagerInterface
    {
        return self::getContainer()->get(EntityManagerInterface::class);
    }

    /**
     * Récupère l'instance gérée par l'EntityManager courant.
     *
     * @template T of object
     *
     * @param T $entity
     *
     * @return T
     */
    protected function reattach(object $entity): object
    {
        $em = $this->em();

        if ($em->contains($entity)) {
            return $entity;
        }

        /** @var T|null $managed */
        $managed = $em->find($entity::class, $entity->getId());

        return $managed ?? $entity;
    }

    protected function createUser(string $email, string $username, bool $admin = false): User
    {
        $user = new User();
        $user
            ->setEmail($email)
            ->setUsername($username)
            ->setRoles($admin ? ['ROLE_ADMIN'] : []);

        $user->setPassword(
            self::getContainer()->get(UserPasswordHasherInterface::class)->hashPassword($user, 'motdepasse1'),
        );

        $this->em()->persist($user);
        $this->em()->flush();

        return $user;
    }

    /**
     * Jeton signé par la vraie chaîne Lexik — pas un jeton fabriqué à la main :
     * le test vérifie ainsi la même configuration que la production.
     */
    protected function tokenFor(User $user): string
    {
        return self::getContainer()->get(JWTTokenManagerInterface::class)->create($user);
    }

    /**
     * Client HTTP, authentifié si un jeton est fourni.
     */
    protected function client(?string $token = null): Client
    {
        $options = [];
        if (null !== $token) {
            $options['headers'] = ['Authorization' => 'Bearer '.$token];
        }

        return static::createClient([], $options);
    }

    protected function createGenre(string $name, string $slug): Genre
    {
        $genre = (new Genre())->setName($name)->setSlug($slug);

        $this->em()->persist($genre);
        $this->em()->flush();

        return $genre;
    }

    protected function createAnime(string $romaji, ?string $english = null, ?string $native = null, Genre ...$genres): Anime
    {
        $anime = new Anime();
        $anime->setTitleRomaji($romaji)->setTitleEnglish($english)->setTitleNative($native);

        foreach ($genres as $genre) {
            $anime->addGenre($this->reattach($genre));
        }

        $this->em()->persist($anime);
        $this->em()->flush();

        return $anime;
    }

    protected function createManga(string $romaji, ?string $english = null, ?string $native = null, Genre ...$genres): Manga
    {
        $manga = new Manga();
        $manga->setTitleRomaji($romaji)->setTitleEnglish($english)->setTitleNative($native);

        foreach ($genres as $genre) {
            $manga->addGenre($this->reattach($genre));
        }

        $this->em()->persist($manga);
        $this->em()->flush();

        return $manga;
    }
}
