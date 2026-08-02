#!/bin/sh
# ===========================================================================
# manga-stream :: restauration PostgreSQL
#
# « Une sauvegarde jamais restaurée n'est pas une sauvegarde. » Ce script
# existe pour que la restauration soit une commande qu'on a déjà tapée, et pas
# une procédure qu'on improvise le jour où la base est perdue.
#
# Deux modes :
#
#   pg-restore.sh verify [fichier.dump]
#       Restaure dans une base JETABLE (manga_stream_restore_check), compare
#       le nombre de tables et de lignes avec la base de production, puis
#       supprime la base jetable. NE TOUCHE PAS aux données de production.
#       C'est le mode à passer en revue régulièrement — idéalement en tâche
#       planifiée. Sans fichier, prend le dump le plus récent.
#
#   pg-restore.sh restore <fichier.dump> [base_cible]
#       LA VRAIE restauration. Écrase la base cible. Exige la variable
#       d'environnement I_UNDERSTAND=yes, parce qu'une faute de frappe ici
#       coûte la production.
#
# Variables : PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE BACKUP_DIR
# ===========================================================================
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
PGHOST="${PGHOST:-database}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-manga}"
PGDATABASE="${PGDATABASE:-manga_stream}"
export PGHOST PGPORT PGUSER PGDATABASE

CHECK_DB="${CHECK_DB:-manga_stream_restore_check}"

log() { echo "[restore] $*"; }

latest_dump() {
    # -t n'est pas portable en POSIX : on trie sur le nom, qui porte un
    # horodatage AAAAMMJJ-HHMMSS, donc lexicographiquement croissant.
    find "$BACKUP_DIR" -maxdepth 1 -name '*.dump' -type f | sort | tail -n 1
}

# Nombre de lignes de chaque table d'une base, trie : la signature qu'on
# compare entre la production et la base restauree.
table_counts() {
    db="$1"
    psql -d "$db" -At -F '|' -c "
        SELECT relname, n_live_tup
        FROM pg_stat_user_tables
        ORDER BY relname;
    " 2>/dev/null
}

# n_live_tup est une ESTIMATION mise a jour par l'autovacuum : elle peut etre
# fausse juste apres une restauration. On la fiabilise par un ANALYZE, qui est
# peu couteux et rend les deux cotes comparables.
refresh_stats() {
    psql -d "$1" -q -c 'ANALYZE;' > /dev/null 2>&1 || true
}

cmd_verify() {
    dump="${1:-$(latest_dump)}"

    if [ -z "$dump" ] || [ ! -f "$dump" ]; then
        log "ECHEC : aucun dump trouve dans ${BACKUP_DIR}"
        exit 1
    fi

    log "dump examine        : $dump ($(du -h "$dump" | cut -f1))"
    log "base de reference   : $PGDATABASE"
    log "base jetable        : $CHECK_DB"

    if ! pg_restore --list "$dump" > /dev/null 2>&1; then
        log "ECHEC : le fichier n'est pas un dump PostgreSQL lisible"
        exit 1
    fi

    # Table rase, au cas ou une verification precedente aurait ete interrompue.
    psql -d postgres -q -c "DROP DATABASE IF EXISTS \"$CHECK_DB\";"
    psql -d postgres -q -c "CREATE DATABASE \"$CHECK_DB\";"

    # --no-owner / --no-privileges : le dump ne doit pas exiger que les roles
    # de la machine d'origine existent ici.
    # On tolere le code de sortie non nul : par defaut pg_restore poursuit
    # apres une erreur non fatale (objet deja present, extension, schema
    # public) et sort quand meme en 1. L'arbitrage se fait sur la comparaison
    # des donnees plus bas, pas sur ce code.
    # Ne PAS ajouter --exit-on-error=false : l'option existe mais ne prend pas
    # d'argument, et pg_restore refuse alors de demarrer — la restauration
    # echoue en silence derriere le `|| {` et on ne le voit qu'au tableau.
    log "restauration dans ${CHECK_DB}..."
    pg_restore --no-owner --no-privileges \
        -d "$CHECK_DB" "$dump" > /tmp/restore.log 2>&1 || {
            log "pg_restore a signale des avertissements :"
            tail -n 20 /tmp/restore.log | sed 's/^/    /'
        }

    refresh_stats "$PGDATABASE"
    refresh_stats "$CHECK_DB"

    src="$(table_counts "$PGDATABASE")"
    dst="$(table_counts "$CHECK_DB")"

    src_tables="$(echo "$src" | grep -c . || true)"
    dst_tables="$(echo "$dst" | grep -c . || true)"

    echo
    printf '%-34s %12s %12s\n' 'TABLE' 'PRODUCTION' 'RESTAUREE'
    printf '%-34s %12s %12s\n' '----------------------------------' '------------' '------------'

    status=0
    echo "$src" | while IFS='|' read -r t n; do
        [ -z "$t" ] && continue
        m="$(echo "$dst" | awk -F'|' -v t="$t" '$1==t {print $2}')"
        [ -z "$m" ] && m='ABSENTE'
        printf '%-34s %12s %12s\n' "$t" "$n" "$m"
    done

    echo
    log "tables : ${src_tables} en production, ${dst_tables} dans la restauration"

    # La comparaison qui fait foi.
    if [ "$src" = "$dst" ]; then
        log "RESULTAT : IDENTIQUE — la sauvegarde est restaurable."
    else
        log "RESULTAT : ECART entre la production et la restauration."
        log "           Un ecart est NORMAL si la base a change depuis le dump."
        log "           Il est ANORMAL si des tables sont absentes."
        status=1
    fi

    psql -d postgres -q -c "DROP DATABASE IF EXISTS \"$CHECK_DB\";"
    log "base jetable supprimee"
    return $status
}

cmd_restore() {
    dump="${1:-}"
    target="${2:-$PGDATABASE}"

    [ -n "$dump" ] || { log "usage: $0 restore <fichier.dump> [base_cible]"; exit 2; }
    [ -f "$dump" ] || { log "ECHEC : $dump introuvable"; exit 1; }

    if [ "${I_UNDERSTAND:-}" != "yes" ]; then
        log "REFUS : cette commande ECRASE la base '${target}'."
        log "Relancer avec I_UNDERSTAND=yes si c'est bien l'intention."
        log "Pour un essai sans risque : $0 verify $dump"
        exit 1
    fi

    log "restauration de $dump dans '${target}' — les donnees actuelles seront perdues"

    # Les connexions ouvertes empechent un DROP DATABASE. On les coupe.
    psql -d postgres -q -c "
        SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = '${target}' AND pid <> pg_backend_pid();" > /dev/null

    psql -d postgres -q -c "DROP DATABASE IF EXISTS \"$target\";"
    psql -d postgres -q -c "CREATE DATABASE \"$target\";"
    pg_restore --no-owner --no-privileges -d "$target" "$dump"

    log "restauration terminee. Redemarrer backend, worker et cron :"
    log "  docker compose restart backend worker cron"
}

case "${1:-}" in
    verify)  shift; cmd_verify "$@" ;;
    restore) shift; cmd_restore "$@" ;;
    latest)  latest_dump ;;
    *)
        echo "usage: $0 {verify [dump] | restore <dump> [base] | latest}" >&2
        exit 2
        ;;
esac
