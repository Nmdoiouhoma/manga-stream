<?php

declare(strict_types=1);

namespace App\Command;

use App\Message\SyncAnilistPage;
use App\MessageHandler\SyncAnilistPageHandler;
use App\Service\Anilist\AnilistException;
use App\Service\Anilist\AnilistMedia;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Console\Style\SymfonyStyle;
use Symfony\Component\Messenger\MessageBusInterface;

/**
 * Synchronise le catalogue depuis AniList.
 *
 * Deux modes :
 *  - par défaut, un message par page est publié sur le transport `async` (Doctrine) ;
 *    un worker `messenger:consume async` fait le travail ;
 *  - avec `--sync`, les pages sont traitées immédiatement dans le processus courant
 *    (pratique pour un premier peuplement ou en CI, sans worker).
 */
#[AsCommand(
    name: 'app:anilist:sync',
    description: 'Importe/actualise le catalogue depuis AniList (upsert idempotent sur anilistId).',
)]
final class AnilistSyncCommand extends Command
{
    public function __construct(
        private readonly MessageBusInterface $bus,
        private readonly SyncAnilistPageHandler $handler,
    ) {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this
            ->addOption('type', 't', InputOption::VALUE_REQUIRED, 'ANIME, MANGA ou BOTH', AnilistMedia::TYPE_ANIME)
            ->addOption('pages', 'p', InputOption::VALUE_REQUIRED, 'Nombre de pages à parcourir', '2')
            ->addOption('per-page', null, InputOption::VALUE_REQUIRED, 'Médias par page (max 50)', '50')
            ->addOption('sync', null, InputOption::VALUE_NONE, 'Traite immédiatement, sans passer par un worker')
            ->setHelp(<<<'HELP'
                Exemples :

                  <info>php %command.full_name% --type=ANIME --pages=2 --per-page=50 --sync</info>
                  <info>php %command.full_name% --type=BOTH --pages=2</info>   (asynchrone, nécessite un worker)

                Le débit sortant est volontairement bridé (~50 req/min) pour ne pas se faire
                bannir par AniList ; deux pages de 50 prennent donc quelques secondes.
                HELP);
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $io = new SymfonyStyle($input, $output);

        $rawType = strtoupper((string) $input->getOption('type'));
        $types = match ($rawType) {
            AnilistMedia::TYPE_ANIME => [AnilistMedia::TYPE_ANIME],
            AnilistMedia::TYPE_MANGA => [AnilistMedia::TYPE_MANGA],
            'BOTH', 'ALL' => [AnilistMedia::TYPE_ANIME, AnilistMedia::TYPE_MANGA],
            default => null,
        };

        if (null === $types) {
            $io->error(\sprintf('Type « %s » invalide : attendu ANIME, MANGA ou BOTH.', $rawType));

            return Command::INVALID;
        }

        $pages = max(1, (int) $input->getOption('pages'));
        $perPage = max(1, min(50, (int) $input->getOption('per-page')));
        $immediate = (bool) $input->getOption('sync');

        $io->title('Synchronisation AniList');
        $io->text(\sprintf(
            'Type(s) : %s — %d page(s) de %d — mode %s',
            implode(', ', $types),
            $pages,
            $perPage,
            $immediate ? 'synchrone' : 'asynchrone (transport Doctrine)',
        ));

        $created = $updated = 0;

        foreach ($types as $type) {
            for ($page = 1; $page <= $pages; ++$page) {
                $message = new SyncAnilistPage($type, $page, $perPage);

                if (!$immediate) {
                    $this->bus->dispatch($message);
                    $io->text(\sprintf('  → %s page %d publiée sur le bus', $type, $page));
                    continue;
                }

                try {
                    $stats = ($this->handler)($message);
                } catch (AnilistException $e) {
                    $io->error(\sprintf('%s page %d : %s', $type, $page, $e->getMessage()));

                    return Command::FAILURE;
                }

                $created += $stats['created'];
                $updated += $stats['updated'];
                $io->text(\sprintf(
                    '  → %s page %d : %d créé(s), %d mis à jour',
                    $type,
                    $page,
                    $stats['created'],
                    $stats['updated'],
                ));

                if (!$stats['hasNextPage']) {
                    $io->text(\sprintf('  → %s : fin du catalogue atteinte.', $type));
                    break;
                }
            }
        }

        if ($immediate) {
            $io->success(\sprintf('%d média(s) créé(s), %d mis à jour.', $created, $updated));
        } else {
            $io->success('Messages publiés. Lancez `php bin/console messenger:consume async` pour les traiter.');
        }

        return Command::SUCCESS;
    }
}
