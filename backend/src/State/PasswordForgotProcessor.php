<?php

declare(strict_types=1);

namespace App\State;

use ApiPlatform\Metadata\Operation;
use ApiPlatform\State\ProcessorInterface;
use App\ApiResource\PasswordForgotRequest;
use App\Service\Security\PasswordResetService;

/**
 * `POST /api/password/forgot` — 204, toujours.
 *
 * Le processor ne décide de rien : il délègue et renvoie. C'est justement ce qui
 * garantit l'absence de branche observable depuis l'extérieur.
 *
 * @implements ProcessorInterface<PasswordForgotRequest, null>
 */
final readonly class PasswordForgotProcessor implements ProcessorInterface
{
    public function __construct(
        private PasswordResetService $passwordReset,
    ) {
    }

    public function process(mixed $data, Operation $operation, array $uriVariables = [], array $context = []): null
    {
        if ($data instanceof PasswordForgotRequest && null !== $data->email) {
            $this->passwordReset->request($data->email);
        }

        return null;
    }
}
