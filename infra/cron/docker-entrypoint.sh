#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# manga-stream :: planificateur de la synchronisation AniList
#
# Pourquoi un service dédié et pas `cron`, et pas Symfony Scheduler ?
#
#   * Symfony Scheduler (symfony/scheduler) aurait été le choix le plus
#     idiomatique, mais il impose d'écrire une classe `#[AsSchedule]` dans
#     backend/src/, et le composant n'est même pas installé. C'est du code
#     applicatif : hors du périmètre infra, et deux coéquipiers travaillent
#     dans backend/ en parallèle.
#
#   * `crond` sait déclencher à heure fixe mais ne sait rien mémoriser. Il ne
#     répond pas à la question « la stack a redémarré cinq fois, faut-il
#     relancer ? » : à chaque démarrage il repartirait de zéro, ou attendrait
#     bêtement le prochain créneau. Aucun état, aucun code de retour conservé.
#
#   * Cette boucle-ci garde un ÉTAT PERSISTANT dans un volume. C'est ce qui
#     permet les deux exigences qui comptent vraiment :
#         - pas de tempête au démarrage,
#         - « quand la dernière synchro a-t-elle tourné, et a-t-elle réussi ? »
#
# ÉTAT (volume `anilist_sync_state`, monté sur /state) :
#   /state/last-run.json   dernier résultat, lisible d'un coup d'œil
#   /state/history.jsonl   une ligne JSON par exécution, append-only
#   /state/sync.lock       verrou anti-concurrence (flock)
#
# CONSULTER :
#   docker compose exec cron anilist-sync-status
#   docker compose logs -f cron
#
# FORCER une synchro immédiate, sans attendre le créneau :
#   docker compose exec cron anilist-sync-now
# ---------------------------------------------------------------------------
set -uo pipefail

STATE_DIR="${ANILIST_SYNC_STATE_DIR:-/state}"
STATE_FILE="${STATE_DIR}/last-run.json"
HISTORY_FILE="${STATE_DIR}/history.jsonl"
LOCK_FILE="${STATE_DIR}/sync.lock"

INTERVAL="${ANILIST_SYNC_INTERVAL:-86400}"          # 24 h
RETRY_DELAY="${ANILIST_SYNC_RETRY_DELAY:-1800}"     # 30 min après un échec
STARTUP_DELAY="${ANILIST_SYNC_STARTUP_DELAY:-60}"   # laisse la stack se poser
RUN_ON_BOOT="${ANILIST_SYNC_RUN_ON_BOOT:-ifnever}"  # ifnever | always | never
TYPE="${ANILIST_SYNC_TYPE:-BOTH}"
PAGES="${ANILIST_SYNC_PAGES:-5}"
PER_PAGE="${ANILIST_SYNC_PER_PAGE:-50}"
# Pages de la passe saisonnière, en plus du balayage général. 0 la désactive.
# Trois pages de 50 couvrent largement un cours (~100 titres dans les faits).
SEASON_PAGES="${ANILIST_SYNC_SEASON_PAGES:-3}"
TIMEOUT="${ANILIST_SYNC_TIMEOUT:-3600}"
ENABLED="${ANILIST_SYNC_ENABLED:-true}"

log() { echo "[anilist-cron] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

# ---------------------------------------------------------------------------
# Arrêt propre
#
# Ce script est PID 1 dans son conteneur, et PID 1 est un cas particulier du
# noyau : un signal dont la disposition est « par défaut » est purement IGNORÉ.
# Sans le trap ci-dessous, le SIGTERM de `docker compose stop` ne fait donc
# rien du tout et docker attend l'intégralité du stop_grace_period (60 s) avant
# de recourir à SIGKILL. Chaque `restart` coûtait effectivement une minute.
#
# Deuxième piège, indépendant du premier : bash ne traite un signal qu'entre
# deux commandes. Un `sleep 86400` en avant-plan ne serait donc interrompu
# qu'à son terme. D'où le sleep lancé en arrière-plan puis attendu : `wait`
# est, lui, interruptible.
# ---------------------------------------------------------------------------
stopping=0
sleep_pid=""

on_term() {
    stopping=1
    [ -n "$sleep_pid" ] && kill "$sleep_pid" 2>/dev/null
    return 0
}

# SIGQUIT est indispensable ici, et c'est un piège coûteux :
# l'image de base php:8.4-fpm-alpine déclare `STOPSIGNAL SIGQUIT` (c'est le
# signal d'arrêt gracieux de php-fpm). `docker compose stop` n'envoie donc PAS
# SIGTERM à ce conteneur mais SIGQUIT. Ne trapper que TERM/INT laisse le signal
# à sa disposition par défaut, ignorée pour PID 1 : le conteneur survit tout le
# stop_grace_period puis meurt en SIGKILL, code 137.
#
# Symptôme observé avant correction : `docker compose stop cron` = 60 s, exit
# 137, alors que `docker kill -s TERM` sortait proprement en exit 0.
trap on_term TERM INT QUIT

nap() { # sleep interruptible
    [ "${1:-0}" -gt 0 ] || return 0
    sleep "$1" &
    sleep_pid=$!
    wait "$sleep_pid" 2>/dev/null
    sleep_pid=""
}

now()      { date -u +%s; }
human()    { printf '%dh%02dm' $(( $1 / 3600 )) $(( ($1 % 3600) / 60 )); }

# epoch -> ISO 8601 UTC.
# Ni `date -d @epoch` (GNU) ni `date -r epoch` (BSD) ne sont portables ici :
# l'image est une alpine, son `date` vient de BusyBox où `-r` attend un FICHIER
# de référence, pas un epoch — la conversion rendrait silencieusement une date
# fausse. PHP est de toute façon présent (c'est l'image backend) et gmdate est
# sans ambiguïté.
iso() { php -r 'echo gmdate("Y-m-d\TH:i:s\Z", (int) $argv[1]);' -- "$1"; }

mkdir -p "$STATE_DIR" 2>/dev/null || true

# Sans répertoire d'état inscriptible, ce service n'a plus aucun intérêt : il
# se comporterait comme un crond sans mémoire et relancerait une synchro
# complète à chaque redémarrage. On le dit franchement au lieu de laisser
# apparaître un « Permission denied » isolé au milieu des logs.
if ! touch "${STATE_DIR}/.writable" 2>/dev/null; then
    log "ERREUR : ${STATE_DIR} n'est pas inscriptible par $(id -un) (uid $(id -u))."
    log "ERREUR : le volume a probablement été créé root:root avant que l'image ne"
    log "ERREUR : fournisse un /state possédé par 'app'. Correctif :"
    log "ERREUR :   docker compose down && docker volume rm manga-stream_anilist_sync_state"
    log "ERREUR :   docker compose build cron && docker compose up -d cron"
    exit 1
fi
rm -f "${STATE_DIR}/.writable"

# ---------------------------------------------------------------------------
# Lecture de l'état. Volontairement en grep/sed plutôt qu'en jq : l'image
# backend est une php-fpm-alpine, elle n'embarque pas jq et on ne va pas
# alourdir l'image de production pour lire deux entiers.
# ---------------------------------------------------------------------------
state_get() { # state_get <clé>  -> valeur, ou vide
    [ -f "$STATE_FILE" ] || return 0
    sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\{0,1\}\([^,\"}]*\)\"\{0,1\}.*/\1/p" "$STATE_FILE" | head -1
}

write_state() { # write_state <started_at> <finished_at> <exit_code> <duration>
    local started="$1" finished="$2" code="$3" duration="$4" outcome
    [ "$code" = "0" ] && outcome="success" || outcome="failure"

    cat > "${STATE_FILE}.tmp" <<JSON
{
  "outcome": "${outcome}",
  "exit_code": ${code},
  "started_at": "$(iso "$started")",
  "finished_at": "$(iso "$finished")",
  "started_at_epoch": ${started},
  "finished_at_epoch": ${finished},
  "duration_seconds": ${duration},
  "command": "app:anilist:sync --type=${TYPE} --pages=${PAGES} --per-page=${PER_PAGE} --sync",
  "interval_seconds": ${INTERVAL}
}
JSON
    # Écriture atomique : un `docker compose exec ... status` concurrent ne doit
    # jamais lire un fichier à moitié écrit.
    mv "${STATE_FILE}.tmp" "$STATE_FILE"

    printf '{"ts":"%s","outcome":"%s","exit_code":%s,"duration_seconds":%s,"type":"%s","pages":%s}\n' \
        "$(iso "$finished")" "$outcome" "$code" "$duration" "$TYPE" "$PAGES" >> "$HISTORY_FILE"
}

# ---------------------------------------------------------------------------
# Une exécution
# ---------------------------------------------------------------------------
run_sync() {
    local started finished code duration season_code

    # --sync : la commande traite les pages EN LIGNE au lieu de les publier sur
    # le bus Messenger. C'est délibéré et c'est le cœur de l'exigence
    # « a-t-elle réussi ? » : en mode bus, la commande rend 0 dès que les
    # messages sont publiés, donc un code de retour 0 ne prouverait rien du
    # tout — l'échec surviendrait plus tard, dans le worker, hors de notre vue.
    # En mode --sync le code de retour reflète la vraie synchro.
    #
    # Le débit reste tenu : la limitation (~50 req/min, 1.2 s entre deux appels)
    # est implémentée dans AnilistClient, donc dans le processus qui appelle,
    # quel qu'il soit. La contourner n'est pas possible depuis ici.
    started=$(now)
    log "démarrage : app:anilist:sync --type=${TYPE} --pages=${PAGES} --per-page=${PER_PAGE} --sync"

    timeout "${TIMEOUT}" php /var/www/html/bin/console app:anilist:sync \
        --type="${TYPE}" \
        --pages="${PAGES}" \
        --per-page="${PER_PAGE}" \
        --sync \
        --no-interaction 2>&1 | sed 's/^/[anilist-cron]   /'
    code=${PIPESTATUS[0]}

    # Seconde passe : le cours en cours de diffusion.
    #
    # Le balayage ci-dessus suit la popularité toutes saisons confondues. Il
    # construit le gros du catalogue, mais ne ramène qu'une vingtaine de titres
    # de la saison courante — celle-ci n'a pas encore eu le temps d'être
    # populaire. C'est trop peu pour l'écran de planning, qui affiche justement
    # cette saison-là. Mesuré sur l'été 2026 : 19 titres après le balayage
    # général, 98 après cette passe.
    #
    # ANIME seulement : un manga n'a pas de saison de diffusion.
    #
    # Son échec ne masque pas un balayage général réussi mais ne passe pas non
    # plus inaperçu : le code de retour du général l'emporte s'il a déjà échoué.
    if [ "${SEASON_PAGES}" -gt 0 ] 2>/dev/null; then
        log "démarrage : app:anilist:sync --type=ANIME --current-season --pages=${SEASON_PAGES} --sync"

        timeout "${TIMEOUT}" php /var/www/html/bin/console app:anilist:sync \
            --type=ANIME \
            --current-season \
            --pages="${SEASON_PAGES}" \
            --per-page="${PER_PAGE}" \
            --sync \
            --no-interaction 2>&1 | sed 's/^/[anilist-cron]   /'
        season_code=${PIPESTATUS[0]}

        if [ "$season_code" != "0" ]; then
            log "passe saisonnière en échec : code ${season_code}"
            [ "$code" = "0" ] && code=$season_code
        fi
    fi

    finished=$(now)
    duration=$(( finished - started ))

    if [ "$code" = "0" ]; then
        log "SUCCÈS en ${duration}s"
    elif [ "$code" = "124" ]; then
        log "ÉCHEC : dépassement du délai maximal (${TIMEOUT}s)"
    else
        log "ÉCHEC : code de sortie ${code} après ${duration}s"
    fi

    write_state "$started" "$finished" "$code" "$duration"
    return "$code"
}

# Le verrou empêche deux synchros simultanées : un `anilist-sync-now` lancé à
# la main pendant que la boucle travaille attendrait sinon, et surtout on
# doublerait le débit sortant vers AniList — le meilleur moyen de se faire
# rate-limiter alors même qu'on a écrit du code pour l'éviter.
run_sync_locked() {
    if command -v flock >/dev/null 2>&1; then
        flock -n 9 || { log "une synchro est déjà en cours -> on passe notre tour"; return 0; }
        run_sync
    else
        run_sync
    fi 9>"$LOCK_FILE"
}

# ---------------------------------------------------------------------------
# Sous-commandes utilitaires
# ---------------------------------------------------------------------------
cmd_status() {
    if [ ! -f "$STATE_FILE" ]; then
        echo "Aucune synchronisation AniList n'a encore été exécutée."
        echo "(état attendu dans ${STATE_FILE})"
        return 0
    fi
    cat "$STATE_FILE"
    local last elapsed
    last=$(state_get finished_at_epoch)
    if [ -n "$last" ]; then
        elapsed=$(( $(now) - last ))
        echo "-- il y a $(human "$elapsed"), prochaine dans $(human $(( INTERVAL - elapsed > 0 ? INTERVAL - elapsed : 0 )))"
    fi
    if [ -f "$HISTORY_FILE" ]; then
        echo "-- 5 dernières exécutions :"
        tail -5 "$HISTORY_FILE" | sed 's/^/   /'
    fi
}

case "${1:-loop}" in
    status)  cmd_status; exit 0 ;;
    now)     run_sync_locked; exit $? ;;
    loop)    : ;;
    *)       exec "$@" ;;
esac

# ---------------------------------------------------------------------------
# Boucle principale
# ---------------------------------------------------------------------------
if [ "$ENABLED" != "true" ] && [ "$ENABLED" != "1" ]; then
    log "ANILIST_SYNC_ENABLED=${ENABLED} -> planificateur désactivé, le conteneur reste inactif."
    # Surtout pas `exec sleep infinity` ni `tail -f /dev/null` : le processus
    # deviendrait PID 1 avec une disposition de signal par défaut, donc sourd à
    # SIGTERM, et `docker compose down` attendrait les 60 s de grâce avant de
    # le tuer. On dort par tranches, en gardant le trap actif.
    while [ "$stopping" = "0" ]; do nap 3600; done
    log "arrêt demandé -> sortie"
    exit 0
fi

log "planificateur démarré : intervalle=$(human "$INTERVAL") type=${TYPE} pages=${PAGES}"

# --- Anti-tempête au démarrage ---------------------------------------------
# LA propriété qui justifie ce service. Sans état persistant, cinq redémarrages
# de la stack = cinq synchros complètes lancées coup sur coup, donc cinq fois
# le volume d'appels vers AniList et un rate-limit garanti.
#
# Ici on relit la date de la dernière exécution TERMINÉE dans le volume et on
# n'attend que le temps restant. Redémarrer la stack ne remet aucun compteur à
# zéro et ne déclenche aucune synchro supplémentaire.
last_finished=$(state_get finished_at_epoch)
last_outcome=$(state_get outcome)

if [ -n "$last_finished" ]; then
    elapsed=$(( $(now) - last_finished ))

    # Après un échec on réessaie plus tôt qu'un cycle complet, mais surtout pas
    # immédiatement : un conteneur qui redémarre en boucle sur une synchro qui
    # échoue martèlerait l'API externe.
    if [ "$last_outcome" = "failure" ]; then
        wait_for=$(( RETRY_DELAY - elapsed ))
        reason="dernière tentative en échec, réessai dans"
    else
        wait_for=$(( INTERVAL - elapsed ))
        reason="dernière synchro réussie il y a $(human "$elapsed"), prochaine dans"
    fi

    if [ "$wait_for" -gt 0 ]; then
        log "${reason} $(human "$wait_for") (état repris depuis ${STATE_FILE}, aucun redémarrage à vide)"
        nap "$wait_for"
    else
        log "créneau déjà dépassé (${reason%%,*}) -> synchro immédiate"
    fi
else
    case "$RUN_ON_BOOT" in
        never)
            log "aucun état antérieur, ANILIST_SYNC_RUN_ON_BOOT=never -> attente d'un cycle complet"
            nap "$INTERVAL"
            ;;
        *)
            # Premier démarrage sur un clone neuf : le catalogue est vide, une
            # synchro immédiate est ce qu'on veut. Le délai laisse simplement à
            # Postgres et aux migrations le temps d'être prêts.
            log "aucun état antérieur -> première synchro dans ${STARTUP_DELAY}s"
            nap "$STARTUP_DELAY"
            ;;
    esac
fi

# Un SIGTERM reçu pendant l'attente initiale ne doit pas déclencher une synchro
# juste avant de sortir.
while [ "$stopping" = "0" ]; do
    run_sync_locked
    code=$?

    [ "$stopping" = "0" ] || break

    if [ "$code" = "0" ]; then
        next=$INTERVAL
    else
        next=$RETRY_DELAY
        log "réessai anticipé dans $(human "$next") au lieu de $(human "$INTERVAL")"
    fi

    log "prochaine synchro dans $(human "$next")"
    nap "$next"
done

log "arrêt demandé -> sortie propre"
exit 0
