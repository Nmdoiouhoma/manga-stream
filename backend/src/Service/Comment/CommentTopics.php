<?php

declare(strict_types=1);

namespace App\Service\Comment;

use App\Entity\Comment;

/**
 * Convention de nommage des topics Mercure **du fil de commentaires**. Source de
 * vérité unique, comme {@see \App\Service\Notification\NotificationTopics} l'est
 * pour les notifications.
 *
 * ```
 * /api/animes/{id}/comments
 * /api/mangas/{id}/comments
 * ```
 *
 * ── Pourquoi une seconde convention, et pas la première ───────────────────────
 * Les notifications sont cloisonnées par utilisateur : un topic par destinataire,
 * publication en `private`. Un fil de commentaires est l'exact opposé — il est
 * *partagé* : tous ceux qui regardent la même fiche doivent voir arriver le même
 * commentaire. Réutiliser `NotificationTopics` était donc impossible, et sa
 * documentation interdit explicitement tout topic non scopé par utilisateur.
 *
 * Le scope est ici l'œuvre, pas la personne, et c'est **volontairement public** :
 *
 *  1. la donnée diffusée est déjà publique — `GET /api/comments?anime=…` ne
 *     demande aucune authentification, le hub ne révèle donc rien de plus ;
 *  2. une update publique est délivrée à tout abonné du topic sans que son JWT
 *     ait à le mentionner. C'est précisément ce qu'il faut ici : le jeton abonné
 *     émis par {@see \App\Service\Notification\MercureSubscriptionFactory} ne
 *     porte que le topic personnel du porteur, et il n'était pas question de
 *     l'élargir œuvre par œuvre — ni d'y mettre un gabarit RFC 6570, qui
 *     ouvrirait au passage les notifications des autres.
 *
 * Conséquence assumée : le hub refusant l'accès anonyme
 * (`MERCURE_ALLOW_ANONYMOUS=false`), un visiteur déconnecté ne reçoit pas le
 * direct. Il voit le fil au chargement et au rafraîchissement, comme avant.
 */
final class CommentTopics
{
    /**
     * Gabarits, tels qu'ils doivent être repris par le frontend.
     */
    public const ANIME_TEMPLATE = '/api/animes/{id}/comments';
    public const MANGA_TEMPLATE = '/api/mangas/{id}/comments';

    public static function forAnimeId(int $id): string
    {
        return \sprintf('/api/animes/%d/comments', $id);
    }

    public static function forMangaId(int $id): string
    {
        return \sprintf('/api/mangas/%d/comments', $id);
    }

    /**
     * Topic du fil auquel appartient ce commentaire.
     *
     * `null` quand la cible est indéterminable — média absent, ou pas encore
     * persisté. La contrainte {@see \App\Validator\ExactlyOneMediaTarget} garantit
     * qu'un commentaire valide vise exactement un anime ou un manga, mais un
     * appelant ne doit pas avoir à s'y fier pour ne pas planter.
     */
    public static function forComment(Comment $comment): ?string
    {
        $animeId = $comment->getAnime()?->getId();

        if (null !== $animeId) {
            return self::forAnimeId($animeId);
        }

        $mangaId = $comment->getManga()?->getId();

        return null !== $mangaId ? self::forMangaId($mangaId) : null;
    }
}
