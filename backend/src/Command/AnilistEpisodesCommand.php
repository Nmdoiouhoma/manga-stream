<?php

declare(strict_types=1);

namespace App\Command;

use App\Entity\Anime;
use App\Enum\NotificationType;
use App\Message\SyncAnilistEpisodes;
use App\MessageHandler\SyncAnilistEpisodesHandler;
use App\Repository\UserRepository;
use App\Service\Anilist\AnilistClient;
use App\Service\Anilist\AnilistException;
use App\Service\Notification\Notifier;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Console\Style\SymfonyStyle;
use Symfony\Component\Messenger\MessageBusInterface;

/**
 * Importe les épisodes des animes déjà présents au catalogue.
 *
 * Séparé de `app:anilist:sync` à dessein : peupler les épisodes suppose que les animes
 * existent déjà (on interroge AniList par identifiant), et le volume de requêtes est
 * d'un tout autre ordre — une requête par lot de 25 animes, contre une par page de 50
 * lors de l'import du catalogue.
 */
#[AsCommand(
    name: 'app:anilist:episodes',
    description: 'Importe les épisodes des animes du catalogue (upsert idempotent sur anime + numéro).',
)]
final class AnilistEpisodesCommand extends Command
{
    public function __construct(
        private readonly MessageBusInterface $bus,
        private readonly SyncAnilistEpisodesHandler $handler,
        private readonly EntityManagerInterface $entityManager,
        private readonly UserRepository $users,
        private readonly Notifier $notifier,
    ) {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this
            ->addOption('limit', 'l', InputOption::VALUE_REQUIRED, 'Nombre maximal d\'animes à traiter (0 = tous)', '0')
            ->addOption('anilist-id', null, InputOption::VALUE_REQUIRED | InputOption::VALUE_IS_ARRAY, 'Restreindre à un ou plusieurs identifiants AniList')
            ->addOption('sync', null, InputOption::VALUE_NONE, 'Traite immédiatement, sans passer par un worker')
            ->setHelp(<<<'HELP'
                Exemples :

                  <info>php %command.full_name% --sync</info>                       (tout le catalogue, ici et maintenant)
                  <info>php %command.full_name% --sync --limit=25</info>
                  <info>php %command.full_name% --anilist-id=21 --anilist-id=1535 --sync</info>

                Ce qu'AniList permet, et ce qu'il ne permet pas :

                  - <comment>streamingEpisodes</comment> donne titre, vignette et URL, mais AUCUN numéro : il
                    est extrait du libellé (« Episode 12 - ... »). Un libellé non numéroté est
                    ignoré, et les numéros dépassant le total annoncé sont rejetés — la liste
                    mélange régulièrement les saisons d'une même franchise ;
                  - <comment>airingSchedule</comment> donne un numéro fiable et une date de diffusion, mais ni
                    titre ni vignette, et n'existe pas pour les séries d'avant ~2015 ;
                  - les numéros manquants sont comblés par une simple numérotation, sans titre
                    ni date. Aucun titre n'est inventé.

                La notification « nouvel épisode » n'est envoyée que si l'anime avait DÉJÀ des
                épisodes en base : le premier remplissage ne notifie personne.
                HELP);
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $io = new SymfonyStyle($input, $output);

        $limit = max(0, (int) $input->getOption('limit'));
        $immediate = (bool) $input->getOption('sync');
        /** @var list<string> $rawIds */
        $rawIds = $input->getOption('anilist-id');
        $explicitIds = array_values(array_filter(array_map(intval(...), $rawIds), static fn (int $id): bool => $id > 0));

        $anilistIds = [] !== $explicitIds ? $explicitIds : $this->catalogueAnilistIds($limit);

        if ([] === $anilistIds) {
            $io->warning('Aucun anime avec un identifiant AniList en base : lancez d\'abord `app:anilist:sync`.');

            return Command::SUCCESS;
        }

        $batches = array_chunk($anilistIds, AnilistClient::EPISODE_BATCH_SIZE);

        $io->title('Import des épisodes AniList');
        $io->text(\sprintf(
            '%d anime(s), %d lot(s) de %d — mode %s',
            \count($anilistIds),
            \count($batches),
            AnilistClient::EPISODE_BATCH_SIZE,
            $immediate ? 'synchrone' : 'asynchrone (transport Doctrine)',
        ));

        $created = $updated = $withTitle = $notified = 0;

        foreach ($batches as $index => $batch) {
            $message = new SyncAnilistEpisodes(array_values($batch));

            if (!$immediate) {
                $this->bus->dispatch($message);
                $io->text(\sprintf('  → lot %d/%d publié sur le bus', $index + 1, \count($batches)));
                continue;
            }

            try {
                $stats = ($this->handler)($message);
            } catch (AnilistException $e) {
                $io->error(\sprintf('Lot %d/%d : %s', $index + 1, \count($batches), $e->getMessage()));

                return Command::FAILURE;
            }

            $created += $stats['created'];
            $updated += $stats['updated'];
            $withTitle += $stats['withTitle'];
            $notified += $stats['notified'];

            $io->text(\sprintf(
                '  → lot %d/%d : %d anime(s), %d épisode(s) créé(s), %d complété(s)',
                $index + 1,
                \count($batches),
                $stats['animes'],
                $stats['created'],
                $stats['updated'],
            ));
        }

        if (!$immediate) {
            $io->success('Messages publiés. Lancez `php bin/console messenger:consume async` pour les traiter.');

            return Command::SUCCESS;
        }

        $io->success(\sprintf(
            '%d épisode(s) créé(s), %d complété(s), %d portant un titre réel, %d notification(s) envoyée(s).',
            $created,
            $updated,
            $withTitle,
            $notified,
        ));

        $this->announceCompletion(['created' => $created, 'updated' => $updated, 'withTitle' => $withTitle]);

        return Command::SUCCESS;
    }

    /**
     * @return list<int>
     */
    private function catalogueAnilistIds(int $limit): array
    {
        $qb = $this->entityManager->createQueryBuilder()
            ->select('a.anilistId')
            ->from(Anime::class, 'a')
            ->andWhere('a.anilistId IS NOT NULL')
            ->orderBy('a.popularity', 'DESC')
            ->addOrderBy('a.id', 'ASC');

        if ($limit > 0) {
            $qb->setMaxResults($limit);
        }

        /** @var list<array{anilistId: int}> $rows */
        $rows = $qb->getQuery()->getScalarResult();

        return array_values(array_map(static fn (array $row): int => (int) $row['anilistId'], $rows));
    }

    /**
     * Signale la fin de l'import aux administrateurs.
     *
     * Émis ici, et non dans le handler : seule la commande connaît la fin de la
     * campagne. En mode asynchrone, les lots sont traités indépendamment les uns des
     * autres et rien ne matérialise « la fin » — aucune notification n'est alors émise,
     * plutôt qu'une notification par lot qui n'aurait aucun sens.
     *
     * @param array<string, int> $stats
     */
    private function announceCompletion(array $stats): void
    {
        $this->notifier->notifyAll(
            $this->users->findAdmins(),
            NotificationType::SYSTEM,
            ['event' => 'anilist.episodes.completed'] + $stats,
        );
    }
}
