<?php

declare(strict_types=1);

namespace App\Service\Notification;

use App\Entity\User;

/**
 * Convention de nommage des topics Mercure. **Source de vérité unique** — le frontend
 * et la configuration du hub en dépendent tous les deux.
 *
 * ```
 * /api/users/{id}/notifications
 * ```
 *
 * Un topic par utilisateur, et rien d'autre. Il n'existe volontairement **aucun topic
 * générique** du type `/notifications` ou `https://manga-stream/notifications` : un
 * topic partagé est indéfendable, puisque tout abonné y verrait passer les
 * notifications de tout le monde (c'est le fourre-tout supprimé côté frontend).
 *
 * Le cloisonnement repose sur deux verrous qui doivent être posés **ensemble** :
 *
 *  1. **côté publication** — toute mise à jour part en `private` ({@see Notifier}).
 *     C'est le verrou décisif : le hub ne délivre une update privée qu'aux abonnés
 *     dont le JWT porte le topic dans `mercure.subscribe`. Une update publique, elle,
 *     est diffusée à *tous* les abonnés du topic, quelles que soient les restrictions
 *     posées à l'abonnement ;
 *  2. **côté abonnement** — le JWT abonné remis au client ne porte que son propre
 *     topic ({@see MercureSubscriptionFactory}), et le hub refuse l'accès anonyme.
 *
 * Le second verrou sans le premier ne protège rien : c'est exactement le piège relevé
 * par le devops.
 */
final class NotificationTopics
{
    /**
     * Gabarit, tel qu'il doit être repris par le hub et le frontend.
     */
    public const TEMPLATE = '/api/users/{id}/notifications';

    /**
     * Topic personnel d'un utilisateur.
     */
    public static function forUser(User $user): string
    {
        $id = $user->getId();

        if (null === $id) {
            throw new \LogicException('Impossible de calculer un topic Mercure pour un utilisateur non persisté.');
        }

        return self::forUserId($id);
    }

    public static function forUserId(int $id): string
    {
        return \sprintf('/api/users/%d/notifications', $id);
    }
}
