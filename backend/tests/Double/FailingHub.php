<?php

declare(strict_types=1);

namespace App\Tests\Double;

use Symfony\Component\Mercure\HubInterface;
use Symfony\Component\Mercure\Jwt\TokenFactoryInterface;
use Symfony\Component\Mercure\Update;

/**
 * Hub systématiquement en panne.
 *
 * Sert à vérifier qu'une publication impossible ne fait échouer ni la requête HTTP ni
 * le worker qui l'a déclenchée : la ligne en base est l'historique qui fait foi, la
 * publication temps réel n'est qu'un raccourci pour les clients connectés.
 */
final class FailingHub implements HubInterface
{
    public function getPublicUrl(): string
    {
        return 'http://mercure.invalid/.well-known/mercure';
    }

    public function getFactory(): ?TokenFactoryInterface
    {
        return null;
    }

    public function publish(Update $update): string
    {
        throw new \RuntimeException('Hub injoignable.');
    }
}
