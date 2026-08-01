<?php

declare(strict_types=1);

namespace App\State;

use ApiPlatform\Metadata\DeleteOperationInterface;
use ApiPlatform\Metadata\Operation;
use ApiPlatform\Metadata\Post;
use ApiPlatform\State\ProviderInterface;
use App\Entity\OwnedByUser;
use App\Entity\User;
use Symfony\Bundle\SecurityBundle\Security;
use Symfony\Component\DependencyInjection\Attribute\AsDecorator;
use Symfony\Component\DependencyInjection\Attribute\AutowireDecorated;

/**
 * Impose le propriétaire d'une ressource personnelle, juste après la désérialisation.
 *
 * Sans cela, un utilisateur authentifié pourrait poster
 * `{"user": "/api/users/42", ...}` et créer un favori, une progression ou un
 * commentaire au nom de quelqu'un d'autre : le champ `user` reçu est donc
 * systématiquement remplacé par l'utilisateur du jeton.
 *
 * Pourquoi un *provider* et non un processor — API Platform 4.3 valide dans la chaîne
 * des providers (`ValidateProvider`), pas dans celle des processors : `ValidateProcessor`
 * ne fait rien tant qu'`ObjectMapper` n'est pas utilisé. Un processor, même placé en
 * tête de chaîne, s'exécuterait donc *après* la validation. Ce provider s'intercale
 * entre la désérialisation et la validation, ce qui a deux conséquences :
 *
 *  - les contraintes `UniqueEntity(['user', 'anime'])` de Favorite et Progress voient
 *    enfin le vrai propriétaire, et un doublon donne un 422 explicite plutôt qu'une
 *    violation d'index remontée en 500 ;
 *  - `user` n'a pas à figurer dans la charge utile du client, sans déclencher pour
 *    autant une erreur sur un champ qu'il ne maîtrise pas.
 *
 * S'applique à toute ressource implémentant {@see OwnedByUser}, sans déclaration
 * opération par opération.
 */
#[AsDecorator('api_platform.state_provider.deserialize')]
final readonly class UserOwnedProvider implements ProviderInterface
{
    public function __construct(
        #[AutowireDecorated]
        private ProviderInterface $decorated,
        private Security $security,
    ) {
    }

    public function provide(Operation $operation, array $uriVariables = [], array $context = []): object|array|null
    {
        $data = $this->decorated->provide($operation, $uriVariables, $context);

        if (!$data instanceof OwnedByUser || $operation instanceof DeleteOperationInterface) {
            return $data;
        }

        $user = $this->security->getUser();

        // À la création, le propriétaire est TOUJOURS écrasé. En mise à jour, on ne le
        // renseigne que s'il est absent : un PATCH envoyant `"user": null` ne doit pas
        // violer la contrainte NOT NULL en base.
        if ($user instanceof User && ($operation instanceof Post || null === $data->getUser())) {
            $data->setUser($user);
        }

        return $data;
    }
}
