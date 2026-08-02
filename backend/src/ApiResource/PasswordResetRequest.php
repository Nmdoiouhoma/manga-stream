<?php

declare(strict_types=1);

namespace App\ApiResource;

use ApiPlatform\Metadata\ApiProperty;
use ApiPlatform\Metadata\ApiResource;
use ApiPlatform\Metadata\Post;
use ApiPlatform\OpenApi\Model;
use App\State\PasswordResetProcessor;
use Symfony\Component\Serializer\Attribute\Groups;
use Symfony\Component\Validator\Constraints as Assert;

/**
 * Consommation d'un jeton de réinitialisation.
 *
 * Le jeton prouve la possession de la boîte mail : c'est lui qui remplace le mot de
 * passe courant exigé partout ailleurs pour un changement de mot de passe
 * ({@see \App\Validator\CurrentPasswordRequired}).
 */
#[ApiResource(
    shortName: 'PasswordReset',
    operations: [
        new Post(
            uriTemplate: '/password/reset',
            status: 204,
            openapi: new Model\Operation(
                summary: 'Pose un nouveau mot de passe à partir d\'un jeton reçu par e-mail.',
                description: <<<'TXT'
                    Le jeton est à usage unique et expire au bout d'une heure. Un jeton
                    inconnu, déjà consommé ou expiré donne un **422** — sans jamais
                    préciser lequel des trois, faute de quoi le message renseignerait un
                    attaquant sur l'état des jetons en circulation.

                    Le succès invalide le jeton ET toutes les autres demandes en cours
                    pour ce compte.

                    Limité en débit — voir la réponse `429`.
                    TXT,
            ),
            processor: PasswordResetProcessor::class,
            output: false,
            description: 'Réinitialise le mot de passe associé au jeton.',
        ),
    ],
    denormalizationContext: ['groups' => ['password:reset']],
)]
final class PasswordResetRequest
{
    #[Assert\NotBlank(message: 'Le jeton est obligatoire.')]
    #[ApiProperty(description: 'Jeton brut reçu par e-mail, tel qu\'il figure dans le lien.')]
    #[Groups(['password:reset'])]
    public ?string $token = null;

    /**
     * Même plancher que partout ailleurs : la règle de robustesse ne doit pas dépendre
     * du chemin emprunté pour changer de mot de passe.
     */
    #[Assert\NotBlank(message: 'Le nouveau mot de passe est obligatoire.')]
    #[Assert\Length(min: 8, max: 4096, minMessage: 'Le mot de passe doit faire au moins {{ limit }} caractères.')]
    #[ApiProperty(description: 'Nouveau mot de passe en clair.')]
    #[Groups(['password:reset'])]
    public ?string $plainPassword = null;
}
