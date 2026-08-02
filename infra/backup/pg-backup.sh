#!/bin/sh
# ===========================================================================
# manga-stream :: sauvegarde PostgreSQL
#
# Deux usages :
#
#   pg-backup.sh once     un dump, puis sortie (utilisable en cron système,
#                         ou à la main avant une migration risquée)
#   pg-backup.sh loop     boucle : un dump toutes les BACKUP_INTERVAL secondes
#                         (c'est ce que lance le service `backup` de
#                         docker-compose.prod.yml)
#
# Variables (toutes ont un défaut) :
#   PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE   connexion
#   BACKUP_DIR            /backups
#   BACKUP_RETENTION_DAYS 14
#   BACKUP_INTERVAL       86400
#   BACKUP_STARTUP_DELAY  300
#
# CE QUI COMPTE ICI : le script ne se contente pas d'écrire un fichier, il
# le RELIT (`pg_restore --list`) avant de l'accepter. Un dump interrompu à
# mi-chemin — disque plein, conteneur tué — produit un fichier de taille
# plausible et parfaitement inutilisable. Sans relecture, on ne le découvre
# que le jour de la restauration.
#
# Ce qui reste à votre charge : SORTIR LES DUMPS DE LA MACHINE. Un backup
# stocké sur le disque du VPS qu'il est censé sauver ne protège que des
# erreurs logiques, pas de la perte du serveur. Voir la section
# « Sauvegarde » du README pour la copie hors-site.
# ===========================================================================
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
BACKUP_INTERVAL="${BACKUP_INTERVAL:-86400}"
BACKUP_STARTUP_DELAY="${BACKUP_STARTUP_DELAY:-300}"

PGHOST="${PGHOST:-database}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-manga}"
PGDATABASE="${PGDATABASE:-manga_stream}"
export PGHOST PGPORT PGUSER PGDATABASE

log() { echo "[backup] $(date -u '+%Y-%m-%dT%H:%M:%SZ') $*"; }

dump_once() {
    mkdir -p "$BACKUP_DIR"

    stamp="$(date -u '+%Y%m%d-%H%M%S')"
    target="${BACKUP_DIR}/${PGDATABASE}-${stamp}.dump"
    tmp="${target}.partial"

    if ! pg_isready -q; then
        log "base injoignable (${PGHOST}:${PGPORT}) -> dump annule"
        return 1
    fi

    log "dump de ${PGDATABASE} vers ${target}"

    # -Fc : format « custom ». Compressé, et surtout restaurable
    # SÉLECTIVEMENT (une table, un schéma) avec pg_restore, ce qu'un dump SQL
    # brut ne permet pas.
    # --no-owner / --no-privileges : le dump se restaure sous n'importe quel
    # rôle, y compris sur un serveur où `manga` n'existe pas encore.
    if ! pg_dump -Fc --no-owner --no-privileges -f "$tmp"; then
        log "ECHEC pg_dump"
        rm -f "$tmp"
        return 1
    fi

    # ---- relecture : c'est ce qui distingue un fichier d'une sauvegarde ----
    if ! pg_restore --list "$tmp" > /dev/null 2>&1; then
        log "ECHEC : le dump produit est illisible, il est jete"
        rm -f "$tmp"
        return 1
    fi

    objects="$(pg_restore --list "$tmp" 2>/dev/null | grep -c '^[0-9]' || true)"
    if [ "${objects:-0}" -lt 1 ]; then
        log "ECHEC : dump lisible mais vide (0 objet), il est jete"
        rm -f "$tmp"
        return 1
    fi

    # Renommage atomique : un fichier .dump présent est un fichier vérifié.
    # Tant que le dump est en cours, il porte l'extension .partial et ne peut
    # pas etre pris pour une sauvegarde valide.
    mv "$tmp" "$target"
    size="$(du -h "$target" | cut -f1)"
    log "OK ${target} (${size}, ${objects} objets)"

    # ---- retention ---------------------------------------------------------
    if [ "$BACKUP_RETENTION_DAYS" -gt 0 ]; then
        removed="$(find "$BACKUP_DIR" -maxdepth 1 -name "${PGDATABASE}-*.dump" \
            -type f -mtime "+${BACKUP_RETENTION_DAYS}" -print -delete | wc -l | tr -d ' ')"
        [ "$removed" -gt 0 ] && log "retention : ${removed} dump(s) de plus de ${BACKUP_RETENTION_DAYS} jours supprimes"
    fi

    # Les .partial abandonnés par un conteneur tué net.
    find "$BACKUP_DIR" -maxdepth 1 -name '*.partial' -type f -mmin +120 -delete 2>/dev/null || true

    kept="$(find "$BACKUP_DIR" -maxdepth 1 -name "${PGDATABASE}-*.dump" -type f | wc -l | tr -d ' ')"
    log "${kept} sauvegarde(s) en stock dans ${BACKUP_DIR}"
    return 0
}

case "${1:-once}" in
    once)
        dump_once
        ;;
    loop)
        # On ne dumpe pas dans la seconde qui suit un redemarrage : la base
        # vient peut-etre de rejouer son journal, et un redeploiement
        # declencherait un dump a chaque fois.
        log "demarrage, premier dump dans ${BACKUP_STARTUP_DELAY}s puis toutes les ${BACKUP_INTERVAL}s"
        sleep "$BACKUP_STARTUP_DELAY"
        while true; do
            dump_once || log "dump en echec, nouvelle tentative au prochain cycle"
            sleep "$BACKUP_INTERVAL"
        done
        ;;
    *)
        echo "usage: $0 {once|loop}" >&2
        exit 2
        ;;
esac
