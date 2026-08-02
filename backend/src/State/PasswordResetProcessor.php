<?php

declare(strict_types=1);

namespace App\State;

use ApiPlatform\Metadata\Operation;
use ApiPlatform\State\ProcessorInterface;
use App\ApiResource\PasswordResetRequest;
use App\Service\Security\PasswordResetService;
use Symfony\Component\HttpKernel\Exception\UnprocessableEntityHttpException;

/**
 * `POST /api/password/reset` — 204, ou 422 si le jeton ne vaut rien.
 *
 * Un seul message pour les trois échecs possibles (jeton inconnu, expiré, déjà
 * consommé) : les distinguer renseignerait un attaquant sur l'état des jetons en
 * circulation, et n'aiderait pas l'utilisateur, dont le geste est le même dans les
 * trois cas — redemander un lien.
 *
 * @implements ProcessorInterface<PasswordResetRequest, null>
 */
final readonly class PasswordResetProcessor implements ProcessorInterface
{
    public function __construct(
        private PasswordResetService $passwordReset,
    ) {
    }

    public function process(mixed $data, Operation $operation, array $uriVariables = [], array $context = []): null
    {
        if (!$data instanceof PasswordResetRequest || null === $data->token || null === $data->plainPassword) {
            throw new UnprocessableEntityHttpException('Requête de réinitialisation incomplète.');
        }

        if (!$this->passwordReset->reset($data->token, $data->plainPassword)) {
            throw new UnprocessableEntityHttpException(
                'Ce lien de réinitialisation n\'est plus valable. Demandez-en un nouveau.',
            );
        }

        return null;
    }
}
