<?php

declare(strict_types=1);

namespace App\Validator;

use Symfony\Component\Validator\Constraint;

/**
 * Contrainte de classe : l'entité doit référencer EXACTEMENT un média,
 * soit un Anime, soit un Manga — jamais les deux, jamais aucun.
 *
 * Volontairement implémentée côté applicatif (et non via un CHECK SQL)
 * pour rester portable et pour produire un message d'erreur exploitable par l'API.
 */
#[\Attribute(\Attribute::TARGET_CLASS)]
class ExactlyOneMediaTarget extends Constraint
{
    public string $messageBoth = 'Une entrée ne peut cibler à la fois un anime et un manga.';
    public string $messageNone = 'Une entrée doit cibler soit un anime, soit un manga.';

    public function getTargets(): string
    {
        return self::CLASS_CONSTRAINT;
    }
}
