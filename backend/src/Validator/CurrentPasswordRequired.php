<?php

declare(strict_types=1);

namespace App\Validator;

use Symfony\Component\Validator\Constraint;

/**
 * Contrainte de classe : changer son mot de passe exige le mot de passe courant.
 *
 * Sans elle, `PATCH /api/users/{id}` acceptait `{"plainPassword": "..."}` sur la seule
 * foi du JWT. Un jeton volé — XSS, poste laissé ouvert, journal de proxy — ne donnait
 * donc pas seulement un accès temporaire au compte : il permettait d'en changer le mot
 * de passe et d'en verrouiller le propriétaire dehors, définitivement. Le jeton expire
 * en une heure ; le mot de passe changé, lui, n'expire pas.
 *
 * Exiger le mot de passe courant transforme cette prise de contrôle définitive en
 * simple accès limité à la durée de vie du jeton.
 *
 * Deux exemptions, l'une et l'autre délibérées :
 *
 *  - le flux de réinitialisation par e-mail, qui ne passe pas par cette ressource :
 *    il prouve la possession de la boîte mail, ce qui est précisément la preuve de
 *    remplacement prévue pour quelqu'un qui a oublié son mot de passe ;
 *  - un administrateur agissant sur un AUTRE compte : il ne connaît évidemment pas le
 *    mot de passe de l'utilisateur, et exiger l'impossible reviendrait à supprimer
 *    l'intervention d'administration plutôt qu'à la sécuriser. Un admin qui change
 *    SON propre mot de passe reste soumis à la règle.
 */
#[\Attribute(\Attribute::TARGET_CLASS)]
class CurrentPasswordRequired extends Constraint
{
    public string $messageMissing = 'Indiquez votre mot de passe actuel pour en changer.';
    public string $messageInvalid = 'Le mot de passe actuel est incorrect.';

    public function getTargets(): string
    {
        return self::CLASS_CONSTRAINT;
    }
}
