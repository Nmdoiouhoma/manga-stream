<?php

declare(strict_types=1);

namespace App\Tests\Double;

use Symfony\Component\Mercure\HubInterface;
use Symfony\Component\Mercure\Jwt\LcobucciFactory;
use Symfony\Component\Mercure\Jwt\TokenFactoryInterface;
use Symfony\Component\Mercure\Update;

/**
 * Hub Mercure de test : enregistre les updates au lieu de les envoyer.
 *
 * Remplace `Symfony\Component\Mercure\HubInterface` en environnement de test
 * (voir `config/services_test.yaml`). **Aucune socket n'est ouverte** — la suite ne
 * dépend donc ni du conteneur `mercure`, ni du réseau, et un hub arrêté ne fait pas
 * virer la CI au rouge.
 *
 * La fabrique de jeton, elle, est bien réelle : c'est la même implémentation qu'en
 * production, seulement avec un secret de test. Les tests vérifient ainsi un vrai JWT
 * signé, et non un jeton bidon qui masquerait une erreur de claims.
 */
final class RecordingHub implements HubInterface
{
    /** @var list<Update> */
    private array $updates = [];

    private readonly TokenFactoryInterface $factory;

    public function __construct(
        private readonly string $publicUrl = 'http://mercure.invalid/.well-known/mercure',
        string $secret = 'test-only-not-a-secret-32-bytes-minimum-for-hs256',
    ) {
        $this->factory = new LcobucciFactory($secret);
    }

    public function getPublicUrl(): string
    {
        return $this->publicUrl;
    }

    public function getFactory(): ?TokenFactoryInterface
    {
        return $this->factory;
    }

    public function publish(Update $update): string
    {
        $this->updates[] = $update;

        return 'urn:uuid:test-'.\count($this->updates);
    }

    /**
     * @return list<Update>
     */
    public function updates(): array
    {
        return $this->updates;
    }

    /**
     * Updates publiées sur un topic donné.
     *
     * @return list<Update>
     */
    public function updatesFor(string $topic): array
    {
        return array_values(array_filter(
            $this->updates,
            static fn (Update $update): bool => \in_array($topic, $update->getTopics(), true),
        ));
    }

    /**
     * Corps JSON décodé d'une update.
     *
     * @return array<string, mixed>
     */
    public static function payloadOf(Update $update): array
    {
        /** @var array<string, mixed> $decoded */
        $decoded = json_decode($update->getData(), true, flags: \JSON_THROW_ON_ERROR);

        return $decoded;
    }

    public function reset(): void
    {
        $this->updates = [];
    }
}
