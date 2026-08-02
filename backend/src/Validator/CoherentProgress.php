<?php

declare(strict_types=1);

namespace App\Validator;

use Symfony\Component\Validator\Constraint;

/**
 * Contrainte de classe : une progression doit être cohérente avec l'œuvre suivie.
 *
 * Jusqu'ici `Progress` ne portait qu'un `Assert\PositiveOrZero` sur chacun de ses
 * deux compteurs. Trois écritures absurdes passaient donc en 201, prouvées au curl :
 *
 *   1. `{"anime": "...", "currentChapter": "42.5"}` — un chapitre sur un ANIME. Le
 *      frontend s'en gardait, l'API non : la règle n'existait que côté client.
 *   2. `{"anime": "...", "currentEpisode": 9999}` sur une série de 25 épisodes —
 *      aucune borne haute.
 *   3. `{"status": "COMPLETED", "currentEpisode": 1}` sur ces mêmes 25 épisodes —
 *      « terminé » sans avoir rien terminé.
 *
 * Les cas 1 et 2 sont rejetés ici (422). Le cas 3 ne l'est PAS : il est normalisé en
 * amont de la validation par {@see \App\State\ProgressCompletionProvider}, qui
 * remplit le compteur jusqu'au total. Voir la décision documentée là-bas.
 *
 * Validation seule, sans contrainte SQL : les totaux (`episodeCount`,
 * `chapterCount`) viennent d'AniList et changent au fil des synchronisations. Un
 * CHECK figerait en base une vérité qui bouge, et transformerait la prochaine
 * resynchronisation en violation d'intégrité.
 */
#[\Attribute(\Attribute::TARGET_CLASS)]
class CoherentProgress extends Constraint
{
    public string $messageChapterOnAnime = 'Un anime se suit en épisodes : renseignez « currentEpisode », pas « currentChapter ».';
    public string $messageEpisodeOnManga = 'Un manga se suit en chapitres : renseignez « currentChapter », pas « currentEpisode ».';
    public string $messageEpisodeAboveTotal = 'L\'épisode courant ({{ current }}) dépasse le nombre d\'épisodes de la série ({{ total }}).';
    public string $messageChapterAboveTotal = 'Le chapitre courant ({{ current }}) dépasse le nombre de chapitres de la série ({{ total }}).';

    public function getTargets(): string
    {
        return self::CLASS_CONSTRAINT;
    }
}
