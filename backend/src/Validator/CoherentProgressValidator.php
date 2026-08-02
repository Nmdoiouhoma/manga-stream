<?php

declare(strict_types=1);

namespace App\Validator;

use App\Entity\Progress;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;
use Symfony\Component\Validator\Exception\UnexpectedTypeException;

class CoherentProgressValidator extends ConstraintValidator
{
    public function validate(mixed $value, Constraint $constraint): void
    {
        if (!$constraint instanceof CoherentProgress) {
            throw new UnexpectedTypeException($constraint, CoherentProgress::class);
        }

        if (!$value instanceof Progress) {
            return;
        }

        $anime = $value->getAnime();
        $manga = $value->getManga();

        // Cible absente ou double : c'est l'affaire d'ExactlyOneMediaTarget. Inutile
        // d'empiler une seconde violation sur la même erreur.
        if ((null === $anime) === (null === $manga)) {
            return;
        }

        $episode = $value->getCurrentEpisode();
        $chapter = $value->getCurrentChapter();

        if (null !== $anime) {
            if (null !== $chapter) {
                $this->context->buildViolation($constraint->messageChapterOnAnime)
                    ->atPath('currentChapter')
                    ->addViolation();
            }

            // `episodeCount` est souvent null : série en cours de diffusion, ou total
            // absent chez AniList. On ne borne que ce qu'on connaît réellement — une
            // borne inventée rejetterait des progressions parfaitement légitimes.
            $total = $anime->getEpisodeCount();
            if (null !== $episode && null !== $total && $episode > $total) {
                $this->context->buildViolation($constraint->messageEpisodeAboveTotal)
                    ->setParameter('{{ current }}', (string) $episode)
                    ->setParameter('{{ total }}', (string) $total)
                    ->atPath('currentEpisode')
                    ->addViolation();
            }

            return;
        }

        if (null !== $episode) {
            $this->context->buildViolation($constraint->messageEpisodeOnManga)
                ->atPath('currentEpisode')
                ->addViolation();
        }

        $total = $manga?->getChapterCount();
        // Comparaison numérique : `currentChapter` est un décimal transporté en
        // chaîne (« 42.5 »), une comparaison de chaînes classerait « 9 » après « 100 ».
        if (null !== $chapter && null !== $total && (float) $chapter > (float) $total) {
            $this->context->buildViolation($constraint->messageChapterAboveTotal)
                ->setParameter('{{ current }}', $chapter)
                ->setParameter('{{ total }}', (string) $total)
                ->atPath('currentChapter')
                ->addViolation();
        }
    }
}
