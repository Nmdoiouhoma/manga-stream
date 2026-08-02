<?php

declare(strict_types=1);

namespace App\State;

use ApiPlatform\Metadata\DeleteOperationInterface;
use ApiPlatform\Metadata\Operation;
use ApiPlatform\State\ProviderInterface;
use App\Entity\Progress;
use App\Enum\ProgressStatus;
use Symfony\Component\DependencyInjection\Attribute\AsDecorator;
use Symfony\Component\DependencyInjection\Attribute\AutowireDecorated;

/**
 * « Terminé » implique une progression complète : on NORMALISE, on ne rejette pas.
 *
 * Le symptôme signalé en test manuel : l'UI laisse le champ « Épisode courant »
 * librement modifiable après un passage en « Terminé », et l'API acceptait
 * `{"status": "COMPLETED", "currentEpisode": 1}` sur une série de 25 épisodes.
 *
 * Deux réponses possibles. Nous retenons la normalisation silencieuse — le compteur
 * est porté au total — plutôt qu'un 422, pour trois raisons :
 *
 *  - c'est le comportement de MyAnimeList et d'AniList, donc celui qu'attend un
 *    utilisateur qui vient de là ;
 *  - un 422 serait inapplicable la moitié du temps : `episodeCount` est null pour
 *    toute série en cours. On aurait donc une règle qui rejette les séries terminées
 *    et laisse passer les autres — une incohérence de plus, pas de moins ;
 *  - l'ordre des champs dans une charge utile ne devrait pas décider du sort de la
 *    requête. Un client qui envoie `status` et `currentEpisode` dans le même PATCH
 *    exprime une intention claire (« j'ai fini ») ; la refuser au motif que le
 *    compteur n'a pas suivi serait pénible sans rien protéger.
 *
 * La normalisation n'est pas invisible pour autant : la valeur corrigée part dans le
 * corps de la réponse 200/201, donc le client la voit immédiatement.
 *
 * Quand le total est inconnu, on ne touche à rien : inventer une valeur serait pire
 * que de laisser le compteur en l'état.
 *
 * Pourquoi un *provider* — API Platform 4.3 valide dans la chaîne des providers
 * (`ValidateProvider`), jamais dans celle des processors tant qu'`ObjectMapper` n'est
 * pas utilisé. Un processor s'exécuterait donc APRÈS la validation, trop tard pour
 * normaliser avant que les bornes de {@see \App\Validator\CoherentProgress} ne
 * s'appliquent. Même raisonnement que {@see UserOwnedProvider}, avec lequel ce
 * décorateur cohabite (priorités explicites, ordre sans importance ici).
 */
#[AsDecorator('api_platform.state_provider.deserialize', priority: -5)]
final readonly class ProgressCompletionProvider implements ProviderInterface
{
    public function __construct(
        #[AutowireDecorated]
        private ProviderInterface $decorated,
    ) {
    }

    public function provide(Operation $operation, array $uriVariables = [], array $context = []): object|array|null
    {
        $data = $this->decorated->provide($operation, $uriVariables, $context);

        if (!$data instanceof Progress || $operation instanceof DeleteOperationInterface) {
            return $data;
        }

        if (ProgressStatus::COMPLETED !== $data->getStatus()) {
            return $data;
        }

        $episodeCount = $data->getAnime()?->getEpisodeCount();
        if (null !== $episodeCount) {
            $data->setCurrentEpisode($episodeCount);
        }

        $chapterCount = $data->getManga()?->getChapterCount();
        if (null !== $chapterCount) {
            $data->setCurrentChapter((string) $chapterCount);
        }

        return $data;
    }
}
