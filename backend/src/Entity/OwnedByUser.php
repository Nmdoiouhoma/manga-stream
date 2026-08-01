<?php

declare(strict_types=1);

namespace App\Entity;

/**
 * Ressource appartenant à un utilisateur.
 *
 * Sert de point d'accroche à deux mécanismes de sécurité :
 *  - {@see \App\Doctrine\Extension\CurrentUserExtension} filtre les collections et les
 *    items sur l'utilisateur courant ;
 *  - {@see \App\State\UserOwnedProvider} impose le propriétaire avant la validation,
 *    pour qu'on ne puisse pas créer une ressource au nom d'un autre.
 */
interface OwnedByUser
{
    public function getUser(): ?User;

    public function setUser(?User $user): static;
}
