<?php

declare(strict_types=1);

namespace App\Command;

use App\Entity\Manga;
use App\Enum\NotificationType;
use App\Repository\UserRepository;
use App\Service\Catalogue\ChapterDeriver;
use App\Service\Notification\Notifier;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Console\Style\SymfonyStyle;

/**
 * Matérialise les chapitres des mangas à partir de leur `chapterCount`.
 *
 * ⚠️ Le nom de la commande dit « catalogue » et non « anilist », et ce n'est pas un
 * détail : **aucune requête réseau n'est faite ici**. AniList n'expose pas les
 * chapitres — son type `Media` n'a que le scalaire `chapters`. Il n'y a donc rien à
 * importer, seulement une numérotation à dériver d'un compte déjà en base.
 *
 * Les lignes produites ne portent que leur numéro : ni titre, ni date de parution, ni
 * URL de lecture. C'est volontairement pauvre, et c'est tout ce que la source permet.
 */
#[AsCommand(
    name: 'app:catalogue:chapters',
    description: 'Dérive les chapitres des mangas depuis chapterCount (AniList n\'expose aucune liste de chapitres).',
)]
final class CatalogueChaptersCommand extends Command
{
    private const FLUSH_EVERY = 20;

    public function __construct(
        private readonly EntityManagerInterface $entityManager,
        private readonly ChapterDeriver $deriver,
        private readonly UserRepository $users,
        private readonly Notifier $notifier,
    ) {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this
            ->addOption('limit', 'l', InputOption::VALUE_REQUIRED, 'Nombre maximal de mangas à traiter (0 = tous)', '0')
            ->setHelp(<<<'HELP'
                <info>php %command.full_name%</info>

                Idempotent : relancer la commande ne recrée pas les chapitres existants.

                Les mangas dont <comment>chapterCount</comment> est nul ou inconnu (séries en cours, pour
                lesquelles AniList ne publie pas de total) sont laissés vides — dériver un
                nombre de chapitres qu'AniList ne connaît pas reviendrait à l'inventer.
                HELP);
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $io = new SymfonyStyle($input, $output);
        $limit = max(0, (int) $input->getOption('limit'));

        $qb = $this->entityManager->getRepository(Manga::class)
            ->createQueryBuilder('m')
            ->orderBy('m.popularity', 'DESC')
            ->addOrderBy('m.id', 'ASC');

        if ($limit > 0) {
            $qb->setMaxResults($limit);
        }

        /** @var list<Manga> $mangas */
        $mangas = $qb->getQuery()->getResult();

        $io->title('Dérivation des chapitres');
        $io->text(\sprintf('%d manga(s) à examiner.', \count($mangas)));

        $created = $skipped = $untouched = 0;
        $processed = 0;

        foreach ($mangas as $manga) {
            $stats = $this->deriver->derive($manga);

            $created += $stats['created'];
            $skipped += $stats['skipped'];

            if (0 === $stats['created'] && 0 === $stats['skipped']) {
                ++$untouched;
            }

            // Flush régulier pour ne pas garder des milliers d'INSERT en attente.
            // Volontairement SANS `clear()` : vider l'EntityManager détacherait les
            // mangas encore à traiter, et le `persist()` d'un Chapter pointant vers une
            // entité détachée exploserait au flush suivant.
            if (0 === ++$processed % self::FLUSH_EVERY) {
                $this->entityManager->flush();
            }
        }

        $this->entityManager->flush();

        $io->success(\sprintf(
            '%d chapitre(s) créé(s), %d déjà présent(s), %d manga(s) sans chapterCount exploitable.',
            $created,
            $skipped,
            $untouched,
        ));

        if ($untouched > 0) {
            $io->note('Ces mangas restent sans chapitre : AniList ne publie pas de total pour eux.');
        }

        $this->notifier->notifyAll(
            $this->users->findAdmins(),
            NotificationType::SYSTEM,
            [
                'event' => 'catalogue.chapters.derived',
                'created' => $created,
                'skipped' => $skipped,
                'withoutCount' => $untouched,
            ],
        );

        return Command::SUCCESS;
    }
}
