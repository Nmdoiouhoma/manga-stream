<?php

declare(strict_types=1);

namespace App\Validator;

use App\Entity\User;
use Symfony\Bundle\SecurityBundle\Security;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;
use Symfony\Component\Validator\Exception\UnexpectedTypeException;

class CurrentPasswordRequiredValidator extends ConstraintValidator
{
    public function __construct(
        private readonly Security $security,
        private readonly UserPasswordHasherInterface $passwordHasher,
    ) {
    }

    public function validate(mixed $value, Constraint $constraint): void
    {
        if (!$constraint instanceof CurrentPasswordRequired) {
            throw new UnexpectedTypeException($constraint, CurrentPasswordRequired::class);
        }

        if (!$value instanceof User) {
            return;
        }

        $plainPassword = $value->getPlainPassword();

        // Aucun changement de mot de passe demandé : rien à prouver.
        if (null === $plainPassword || '' === $plainPassword) {
            return;
        }

        // Création de compte : il n'y a pas encore de mot de passe courant. La
        // colonne vaut '' tant que UserPasswordHasherProcessor n'a pas tourné.
        if ('' === $value->getPassword()) {
            return;
        }

        $current = $this->security->getUser();

        // Hors requête authentifiée (console, fixtures) ou administrateur agissant
        // sur un autre compte : la règle ne s'applique pas. Voir la contrainte pour
        // le raisonnement.
        if (!$current instanceof User || $current->getId() !== $value->getId()) {
            return;
        }

        $currentPassword = $value->getCurrentPassword();

        if (null === $currentPassword || '' === $currentPassword) {
            $this->context->buildViolation($constraint->messageMissing)
                ->atPath('currentPassword')
                ->addViolation();

            return;
        }

        // `$value` est l'entité gérée par Doctrine : `password` n'étant ni lisible ni
        // inscriptible via l'API, il porte encore le hachage d'AVANT la requête.
        // C'est bien contre celui-là qu'on vérifie.
        if (!$this->passwordHasher->isPasswordValid($value, $currentPassword)) {
            $this->context->buildViolation($constraint->messageInvalid)
                ->atPath('currentPassword')
                ->addViolation();
        }
    }
}
