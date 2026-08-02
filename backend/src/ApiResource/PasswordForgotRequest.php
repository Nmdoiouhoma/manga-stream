<?php

declare(strict_types=1);

namespace App\ApiResource;

use ApiPlatform\Metadata\ApiProperty;
use ApiPlatform\Metadata\ApiResource;
use ApiPlatform\Metadata\Post;
use ApiPlatform\OpenApi\Model;
use App\State\PasswordForgotProcessor;
use Symfony\Component\Serializer\Attribute\Groups;
use Symfony\Component\Validator\Constraints as Assert;

/**
 * Demande d'un lien de réinitialisation.
 *
 * Répond **204 dans tous les cas**, y compris pour une adresse inconnue. Ce n'est pas
 * une approximation : renvoyer 404 sur une adresse absente ferait de cet endpoint un
 * oracle d'énumération. Quelques milliers de requêtes suffiraient alors à extraire la
 * liste des comptes du site — une information qui alimente ensuite le hameçonnage
 * ciblé et le bourrage d'identifiants.
 *
 * Le corollaire est que le client ne peut RIEN déduire de la réponse, et ne doit donc
 * jamais afficher « adresse inconnue ». Le message correct est invariablement « si un
 * compte existe pour cette adresse, un e-mail vient d'être envoyé ».
 */
#[ApiResource(
    shortName: 'PasswordForgot',
    operations: [
        new Post(
            uriTemplate: '/password/forgot',
            status: 204,
            openapi: new Model\Operation(
                summary: 'Demande un e-mail de réinitialisation de mot de passe.',
                description: <<<'TXT'
                    Répond **204 quelle que soit l'adresse envoyée**, existante ou non.
                    C'est délibéré : distinguer les deux cas transformerait l'endpoint en
                    oracle d'énumération des comptes. Le client ne doit donc jamais
                    afficher « adresse inconnue ».

                    L'e-mail part en tâche de fond (Messenger) : la réponse n'attend pas
                    le serveur SMTP. Le lien reste valide **une heure** et ne sert
                    **qu'une fois** ; toute demande antérieure encore en vol est
                    invalidée.

                    Limité en débit — voir la réponse `429`.
                    TXT,
            ),
            processor: PasswordForgotProcessor::class,
            output: false,
            description: 'Envoie un lien de réinitialisation si un compte correspond.',
            validationContext: ['groups' => ['Default']],
        ),
    ],
    denormalizationContext: ['groups' => ['password:forgot']],
)]
final class PasswordForgotRequest
{
    #[Assert\NotBlank(message: 'L\'adresse e-mail est obligatoire.')]
    #[Assert\Email(message: 'Cette adresse e-mail n\'est pas valide.')]
    #[ApiProperty(example: 'utilisateur@example.com')]
    #[Groups(['password:forgot'])]
    public ?string $email = null;
}
