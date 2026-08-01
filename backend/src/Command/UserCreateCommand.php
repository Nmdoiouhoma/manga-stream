<?php

declare(strict_types=1);

namespace App\Command;

use App\Entity\User;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputArgument;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Console\Style\SymfonyStyle;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;
use Symfony\Component\Validator\Validator\ValidatorInterface;

/**
 * Crée un compte en console.
 *
 * Seule façon d'obtenir un `ROLE_ADMIN` : les rôles ne sont pas attribuables via
 * l'API (voir {@see User::$roles}). Sert aussi à créer un compte de démonstration
 * sans passer par le frontend.
 */
#[AsCommand(
    name: 'app:user:create',
    description: 'Crée un utilisateur (option --admin pour lui donner ROLE_ADMIN).',
)]
final class UserCreateCommand extends Command
{
    public function __construct(
        private readonly EntityManagerInterface $entityManager,
        private readonly UserPasswordHasherInterface $passwordHasher,
        private readonly ValidatorInterface $validator,
    ) {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this
            ->addArgument('email', InputArgument::REQUIRED, 'Adresse e-mail (identifiant de connexion)')
            ->addArgument('username', InputArgument::REQUIRED, 'Nom affiché')
            ->addArgument('password', InputArgument::REQUIRED, 'Mot de passe en clair (8 caractères minimum)')
            ->addOption('admin', null, InputOption::VALUE_NONE, 'Donne le rôle ROLE_ADMIN');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $io = new SymfonyStyle($input, $output);

        $email = (string) $input->getArgument('email');
        $repository = $this->entityManager->getRepository(User::class);

        if (null !== $repository->findOneBy(['email' => $email])) {
            $io->error(\sprintf('Un compte existe déjà pour « %s ».', $email));

            return Command::FAILURE;
        }

        $user = new User();
        $user
            ->setEmail($email)
            ->setUsername((string) $input->getArgument('username'))
            ->setPlainPassword((string) $input->getArgument('password'))
            ->setRoles($input->getOption('admin') ? ['ROLE_ADMIN'] : []);

        $violations = $this->validator->validate($user);
        if (\count($violations) > 0) {
            foreach ($violations as $violation) {
                $io->error(\sprintf('%s : %s', $violation->getPropertyPath(), $violation->getMessage()));
            }

            return Command::INVALID;
        }

        $user->setPassword($this->passwordHasher->hashPassword($user, (string) $user->getPlainPassword()));
        $user->eraseCredentials();

        $this->entityManager->persist($user);
        $this->entityManager->flush();

        $io->success(\sprintf(
            'Compte « %s » créé (%s).',
            $user->getUsername(),
            implode(', ', $user->getRoles()),
        ));

        return Command::SUCCESS;
    }
}
