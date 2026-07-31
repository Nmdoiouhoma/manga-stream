<?php

declare(strict_types=1);

namespace App\Validator;

use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;
use Symfony\Component\Validator\Exception\UnexpectedTypeException;

class ExactlyOneMediaTargetValidator extends ConstraintValidator
{
    public function validate(mixed $value, Constraint $constraint): void
    {
        if (!$constraint instanceof ExactlyOneMediaTarget) {
            throw new UnexpectedTypeException($constraint, ExactlyOneMediaTarget::class);
        }

        if (null === $value) {
            return;
        }

        if (!\is_object($value) || !method_exists($value, 'getAnime') || !method_exists($value, 'getManga')) {
            return;
        }

        $hasAnime = null !== $value->getAnime();
        $hasManga = null !== $value->getManga();

        if ($hasAnime && $hasManga) {
            $this->context->buildViolation($constraint->messageBoth)
                ->atPath('anime')
                ->addViolation();

            return;
        }

        if (!$hasAnime && !$hasManga) {
            $this->context->buildViolation($constraint->messageNone)
                ->atPath('anime')
                ->addViolation();
        }
    }
}
