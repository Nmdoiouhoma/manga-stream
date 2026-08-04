#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# manga-stream :: backend container entrypoint
#
# Two roles share this script (and the same image):
#
#   docker-entrypoint.sh php-fpm   -> the HTTP backend (default CMD)
#   docker-entrypoint.sh worker    -> the Messenger consumer (service `worker`)
#
# In dev the source tree is bind-mounted, so `vendor/` may not exist yet on a
# fresh clone. We install dependencies once, then hand over to the real
# process.
# ---------------------------------------------------------------------------
set -e

cd /var/www/html

log() { echo "[entrypoint] $*"; }

# ---------------------------------------------------------------------------
# JWT keypair (lexik/jwt-authentication-bundle)
#
# The bundle signs its tokens with an RSA keypair that lives in
# backend/config/jwt/. Those files are secrets: they are gitignored and MUST
# NEVER be committed (this repository is public). Generating them here means a
# fresh clone works with a plain `docker compose up` — no manual step, and no
# key material stored in git.
#
# Set GENERATE_JWT_KEYS=0 to opt out (e.g. when you mount your own keys).
# ---------------------------------------------------------------------------
generate_jwt_keys() {
    [ "${GENERATE_JWT_KEYS:-1}" = "1" ] || return 0
    [ -d config ] || return 0
    if [ -f config/jwt/private.pem ] && [ -f config/jwt/public.pem ]; then
        # Les droits sont resserrés même sur une paire déjà présente : quand un
        # volume nommé VIDE est monté, docker y recopie le contenu de l'image
        # AVEC SES DROITS. Une clé privée arrivée là en 0666 y resterait sinon
        # jusqu'à la fin des temps.
        chmod 600 config/jwt/private.pem 2>/dev/null || true
        chmod 644 config/jwt/public.pem 2>/dev/null || true
        return 0
    fi

    if ! command -v openssl >/dev/null 2>&1; then
        log "openssl missing -> cannot generate the JWT keypair"
        return 0
    fi

    log "JWT keypair missing -> generating an RSA 4096 pair in config/jwt/"
    mkdir -p config/jwt || { log "config/jwt/ is not writable -> skipped"; return 0; }

    # Empty passphrase => unencrypted key. Lexik accepts both, but the compose
    # stack always sets JWT_PASSPHRASE.
    if [ -n "${JWT_PASSPHRASE:-}" ]; then
        export JWT_PASSPHRASE
        openssl genpkey -quiet -out config/jwt/private.pem \
            -aes256 -pass env:JWT_PASSPHRASE \
            -algorithm rsa -pkeyopt rsa_keygen_bits:4096 || {
            log "private key generation failed -> skipped"; return 0; }
        openssl pkey -in config/jwt/private.pem -passin env:JWT_PASSPHRASE \
            -out config/jwt/public.pem -pubout || {
            log "public key extraction failed -> skipped"; return 0; }
    else
        openssl genpkey -quiet -out config/jwt/private.pem \
            -algorithm rsa -pkeyopt rsa_keygen_bits:4096 || {
            log "private key generation failed -> skipped"; return 0; }
        openssl pkey -in config/jwt/private.pem \
            -out config/jwt/public.pem -pubout || {
            log "public key extraction failed -> skipped"; return 0; }
    fi

    chmod 600 config/jwt/private.pem 2>/dev/null || true
    chmod 644 config/jwt/public.pem 2>/dev/null || true
    log "JWT keypair ready (config/jwt/private.pem + public.pem, gitignored)"
}

# ---------------------------------------------------------------------------
# CACHE SYMFONY — reconstruit au démarrage, jamais hérité de l'image
#
# LE BUG QUE CETTE FONCTION CORRIGE
#
#   En production (APP_DEBUG=0), Symfony ne vérifie PAS la fraîcheur du
#   conteneur compilé : s'il trouve var/cache/prod/, il le charge tel quel.
#   Un cache périmé ou incomplet ne provoque donc aucune erreur — l'application
#   démarre, sert le catalogue, et se contente d'ignorer tout ce qui a été
#   ajouté après la génération de ce cache. Concrètement, sur ce projet :
#   /api/register, /api/me, /api/password/forgot, /api/password/reset et
#   /api/mercure/subscription répondaient 404, /api/login retombait sur le
#   handler SPA de Caddy, et le filtre custom `?title=` était ignoré (250
#   résultats au lieu de 3) — pendant que les filtres natifs fonctionnaient.
#   Une panne partielle, silencieuse, qui ressemble à un problème de front.
#
#   Deux chemins y menaient, indépendants l'un de l'autre :
#     a) le cache de la machine de build recopié dans l'image (corrigé par
#        infra/backend/Dockerfile.dockerignore) ;
#     b) un cache VIDE rempli paresseusement à la première requête, par
#        plusieurs enfants php-fpm en concurrence — le cas du serveur AWS,
#        qui construit depuis un clone git propre.
#
# CE QU'ON FAIT ICI, ET POURQUOI DANS CET ORDRE
#
#   `rm -rf` PUIS `cache:warmup`, et pas `cache:clear` : `cache:clear` doit
#   d'abord démarrer le noyau, donc CHARGER le cache qu'on soupçonne d'être
#   cassé. Sur un cache réellement corrompu il échoue (constaté : « no
#   extension able to load the configuration for lexik_jwt_authentication »,
#   parce que la liste de bundles mise en cache datait d'avant l'installation
#   du bundle). Supprimer le répertoire ne dépend, lui, de rien.
#
#   Le warmup a lieu AVANT que php-fpm ne soit exec'é, donc avant la première
#   requête : un seul processus construit le cache, il n'y a pas de course.
#
# COÛT : quelques secondes au démarrage du conteneur (mesuré ~4 s sur une
# t3.micro). Assumé — voir la note en fin de infra/backend/Dockerfile.
#
# WARMUP_CACHE=auto (défaut) -> uniquement si APP_ENV=prod
#              =1            -> toujours
#              =0            -> jamais (débogage, ou warmup fait autrement)
# ---------------------------------------------------------------------------
warm_cache() {
    local mode="${WARMUP_CACHE:-auto}"
    local env_name="${APP_ENV:-prod}"

    [ "$mode" = "0" ] && return 0
    [ -f bin/console ] || return 0
    if [ "$mode" = "auto" ] && [ "$env_name" != "prod" ]; then
        # En dev le code est bind-monté et APP_DEBUG=1 : Symfony invalide son
        # cache tout seul dès qu'un fichier change. Un warmup ici ne ferait
        # qu'allonger chaque `docker compose up` sans rien garantir de plus.
        return 0
    fi

    log "cache: purge de var/cache/${env_name} puis warmup (APP_ENV=${env_name})"
    rm -rf "var/cache/${env_name}" 2>/dev/null || true

    if php bin/console cache:warmup --no-interaction --no-ansi; then
        log "cache: warmup terminé"
        return 0
    fi

    log "cache: ÉCHEC du warmup"
    return 1
}

# ---------------------------------------------------------------------------
# CONTRAT DE DÉMARRAGE — le garde-fou bruyant
#
# Un conteneur qui refuse de démarrer se voit tout de suite. Une application
# qui démarre en ayant silencieusement perdu l'inscription et la connexion,
# non : le catalogue répond, la page s'affiche, la supervision est au vert, et
# on cherche du côté du frontend. C'est exactement ce qui s'est produit trois
# fois ici. Ce contrôle transforme donc la panne partielle silencieuse en
# refus de démarrage explicite.
#
# On vérifie que les routes CRITIQUES et NON TRIVIALES sont bien dans le
# routeur. « Non triviales » au sens : déclarées ailleurs que par une entité
# Doctrine — src/ApiResource/, contrôleurs custom, security.yaml — donc
# précisément celles qu'un cache incomplet perd en premier. Inutile de lister
# /api/animes : le jour où le cache est cassé, elle répond quand même.
#
# NE S'APPLIQUE QU'EN PRODUCTION, et c'est délibéré. En développement le code
# est bind-monté et incomplet par nature — un coéquipier peut très
# légitimement avoir, à un instant donné, un `security.yaml` en cours d'édition
# ou une ressource à moitié écrite. Faire refuser le démarrage à son conteneur
# pour ça remplacerait un bug de production par une nuisance quotidienne. Et
# `debug:router` en dev construirait le cache de dev à chaque `up`, pour rien.
#
# Réglages :
#   STARTUP_CONTRACT_CHECK=auto  (défaut) contrôle uniquement si APP_ENV=prod
#                              =1        contrôle toujours
#                              =0        jamais (soupape de secours ; si vous
#                                        l'utilisez en production, ouvrez un
#                                        ticket dans la foulée : soit le
#                                        contrat est faux, soit le cache l'est)
#   REQUIRED_ROUTES="..."      remplace la liste (chemins séparés par des
#                              espaces). À tenir à jour avec le backend.
# ---------------------------------------------------------------------------
REQUIRED_ROUTES_DEFAULT="/api/register /api/me /api/login /api/password/forgot /api/password/reset /api/mercure/subscription"

# Classes dont la présence dans le conteneur compilé est vérifiée en plus des
# routes. Un filtre custom ne crée aucune route : quand API Platform perd ses
# métadonnées, `?title=naruto` renvoie tout le catalogue au lieu de filtrer —
# silencieux, et faux.
REQUIRED_CLASSES_DEFAULT="App\\Filter\\CombinedTitleFilter"

assert_startup_contract() {
    local mode="${STARTUP_CONTRACT_CHECK:-auto}"
    local env_name="${APP_ENV:-prod}"

    [ "$mode" = "0" ] && return 0
    [ -f bin/console ] || return 0
    if [ "$mode" = "auto" ] && [ "$env_name" != "prod" ]; then
        return 0
    fi

    local required="${REQUIRED_ROUTES:-$REQUIRED_ROUTES_DEFAULT}"
    local classes="${REQUIRED_CLASSES:-$REQUIRED_CLASSES_DEFAULT}"
    local declared missing="" path class short

    declared=$(php bin/console debug:router --no-ansi 2>/dev/null \
        | awk 'NF > 1 { print $NF }' \
        | sed -e 's/{\._format}$//' -e 's/\.{_format}$//')

    if [ -z "$declared" ]; then
        contract_failure "le routeur est vide ou 'debug:router' a échoué"
        return 1
    fi

    for path in $required; do
        printf '%s\n' "$declared" | grep -qxF "$path" || missing="${missing} ${path}"
    done

    if [ -n "$missing" ]; then
        contract_failure "routes absentes du routeur :${missing}"
        return 1
    fi

    # Le conteneur compilé référence les classes avec des antislashs échappés
    # ou non selon le contexte ; on cherche donc le nom court, suffisant pour
    # lever le doute et sans coût (grep sur var/cache, pas de recompilation).
    for class in $classes; do
        short="${class##*\\}"
        if ! grep -rqlF "$short" "var/cache/${env_name}" 2>/dev/null; then
            missing="${missing} ${class}"
        fi
    done

    if [ -n "$missing" ]; then
        contract_failure "classes absentes du conteneur compilé :${missing}"
        return 1
    fi

    log "contrat de démarrage vérifié : $(printf '%s\n' "$declared" | grep -c . ) routes, dont toutes les routes critiques"
    return 0
}

contract_failure() {
    cat >&2 <<EOF

################################################################################
# DÉMARRAGE REFUSÉ — le contrat d'API n'est pas satisfait
#
# $1
#
# L'application aurait démarré en apparence NORMALE : le catalogue répond, la
# page s'affiche, et seules l'inscription et la connexion tombent — en 404 côté
# API, donc en HTML de la SPA côté navigateur. On préfère un conteneur qui
# refuse de démarrer.
#
# Cause la plus probable : le cache Symfony ne correspond pas au code déployé.
#
# QUE FAIRE
#   1. Reconstruire l'image sans cache :
#        docker compose -f docker-compose.yml -f docker-compose.prod.yml \\
#          build --no-cache backend
#   2. Vérifier que l'image n'embarque pas d'artefacts de l'hôte (ces trois
#      commandes doivent toutes renvoyer « vide » ou une erreur « No such
#      file ») :
#        docker run --rm --entrypoint sh manga-stream-backend:prod -c \\
#          'ls var/cache; ls .env.local; ls config/jwt'
#   3. Si les routes attendues ont légitimement changé côté backend, mettre à
#      jour REQUIRED_ROUTES (voir infra/backend/docker-entrypoint.sh) plutôt
#      que de désactiver le contrôle.
#
# Soupape de secours, en connaissance de cause : STARTUP_CONTRACT_CHECK=0
################################################################################

EOF
}

# ---------------------------------------------------------------------------
# Messenger worker
#
# `messenger:consume` is a long-running process that is EXPECTED to exit: the
# --time-limit / --memory-limit flags make it stop periodically so that PHP
# never leaks memory over days. Restarting it is our job.
#
# It also legitimately fails while the rest of the team is still working:
#   * symfony/messenger not installed yet,
#   * the `async` transport still commented out in config/packages/messenger.yaml,
#   * the `messenger_messages` table not created yet (its migration is not
#     merged yet).
#
# In all those cases we wait and retry INSIDE the container instead of letting
# it die: Docker would then restart it every second (a "crash loop"), flooding
# the logs and burning CPU. The container therefore stays Up and starts
# consuming on its own as soon as the backend side is ready.
# ---------------------------------------------------------------------------
worker_child=""
worker_stopping=0

worker_terminate() {
    worker_stopping=1
    if [ -n "$worker_child" ]; then
        # Messenger handles SIGTERM gracefully: it finishes the message being
        # processed, then exits. Never SIGKILL a consumer.
        kill -TERM "$worker_child" 2>/dev/null || true
    fi
}

run_messenger_worker() {
    local transport="${MESSENGER_CONSUME_TRANSPORTS:-async}"
    local time_limit="${MESSENGER_TIME_LIMIT:-3600}"
    local memory_limit="${MESSENGER_MEMORY_LIMIT:-128M}"
    local retry_delay="${MESSENGER_RETRY_DELAY:-15}"
    local verbosity="${MESSENGER_VERBOSITY:--vv}"
    local not_ready=0
    local status=0

    # SIGQUIT en plus de TERM/INT : l'image de base php:8.4-fpm-alpine declare
    # `STOPSIGNAL SIGQUIT` (arret gracieux de php-fpm), donc `docker compose
    # stop`/`down` envoie SIGQUIT et non SIGTERM. Sans ce trap le signal garde
    # sa disposition par defaut, ignoree pour PID 1 : le worker restait en vie
    # tout le stop_grace_period (30 s) puis etait tue en SIGKILL (code 137),
    # cote a cote avec un message en cours de traitement.
    trap worker_terminate TERM INT QUIT

    log "worker: transport='${transport}' time-limit=${time_limit}s memory-limit=${memory_limit}"

    while [ "$worker_stopping" = "0" ]; do

        # -- Is the messenger component there at all? ----------------------
        if [ ! -f bin/console ] || \
           ! php bin/console list messenger --no-ansi 2>/dev/null | grep -q 'messenger:consume'; then
            worker_wait "$not_ready" "$retry_delay" \
                "symfony/messenger is not available yet (bin/console has no messenger:consume)"
            not_ready=$((not_ready + 1))
            continue
        fi

        # -- Is the transport configured AND its storage created? ----------
        # `messenger:stats <transport>` runs a COUNT() on the transport. Beware:
        # it exits 0 even when things are wrong, so we read its OUTPUT:
        #   "does not exist"                -> transport not declared in
        #                                      config/packages/messenger.yaml
        #   "Unable to get message count"   -> declared, but the SQL table is
        #                                      missing (migration not run)
        # Probing here means we never launch messenger:consume just to watch it
        # crash with a 20-line stack trace every few seconds.
        stats_output=""
        set +e
        stats_output=$(php bin/console messenger:stats "$transport" --no-ansi 2>&1)
        stats_status=$?
        set -e

        if printf '%s' "$stats_output" | grep -q "\"${transport}\" transport does not exist"; then
            worker_wait "$not_ready" "$retry_delay" \
                "transport '${transport}' is not declared yet in config/packages/messenger.yaml"
            not_ready=$((not_ready + 1))
            continue
        fi

        if [ "$stats_status" -ne 0 ] || \
           printf '%s' "$stats_output" | grep -q 'Unable to get message count'; then
            worker_wait "$not_ready" "$retry_delay" \
                "transport '${transport}' is declared but not queryable — the messenger_messages table is probably not migrated yet ($(printf '%s' "$stats_output" | grep -m1 -Ei 'error|exception|relation|SQLSTATE' || echo 'see: docker compose exec backend php bin/console messenger:stats'))"
            not_ready=$((not_ready + 1))
            continue
        fi

        if [ "$not_ready" -gt 0 ]; then
            log "worker: transport '${transport}' is ready -> starting the consumer"
            not_ready=0
        fi

        # -- Consume ------------------------------------------------------
        set +e
        php bin/console messenger:consume "$transport" \
            "$verbosity" \
            --time-limit="$time_limit" \
            --memory-limit="$memory_limit" &
        worker_child=$!
        wait "$worker_child"
        status=$?
        set -e
        worker_child=""

        [ "$worker_stopping" = "1" ] && break

        if [ "$status" -eq 0 ]; then
            # Normal stop: --time-limit or --memory-limit was reached.
            log "worker: consumer stopped cleanly (time/memory limit) -> restarting"
        else
            log "worker: consumer exited with status ${status} -> restarting in ${retry_delay}s"
            sleep "$retry_delay" || true
        fi
    done

    log "worker: SIGTERM received -> shutting down"
    return 0
}

# Logs the first occurrence of a transient problem, then only one line every
# ~20 attempts (5 min at the default 15s delay) so the logs stay readable.
worker_wait() {
    local attempt="$1" delay="$2" message="$3"
    if [ "$attempt" -eq 0 ] || [ $((attempt % 20)) -eq 0 ]; then
        log "worker: ${message} -> waiting (retry every ${delay}s)"
    fi
    sleep "$delay" || true
}

# ---------------------------------------------------------------------------
# Shared bootstrap
# ---------------------------------------------------------------------------
if [ "${1#-}" != "$1" ]; then
    # Allow `docker compose run backend -v` style invocations.
    set -- php-fpm "$@"
fi

# `check` : pseudo-commande sans service. Reconstruit le cache et vérifie le
# contrat, puis sort. C'est ce que joue l'intégration continue sur l'image de
# production fraîchement construite — ainsi la régression du cache incomplet ne
# peut plus atteindre le serveur sans avoir d'abord fait rougir la CI :
#
#   docker run --rm -e APP_ENV=prod manga-stream-backend:prod check
if [ "$1" = "check" ]; then
    # `check` est explicite : on force les deux contrôles, quel que soit
    # APP_ENV. Sans ça, une CI qui oublierait APP_ENV=prod verrait cette étape
    # passer au vert en n'ayant rien vérifié du tout.
    WARMUP_CACHE=1 warm_cache || exit 1
    STARTUP_CONTRACT_CHECK=1 assert_startup_contract || exit 1
    log "check: l'image satisfait le contrat de démarrage"
    exit 0
fi

if [ "$1" = "php-fpm" ] || [ "$1" = "php" ] || [ "$1" = "composer" ] || [ "$1" = "worker" ]; then

    if [ -f composer.json ] && [ ! -f vendor/autoload_runtime.php ]; then
        echo "[entrypoint] vendor/ missing -> composer install"
        composer install --no-interaction --prefer-dist --no-progress || \
            echo "[entrypoint] composer install failed, continuing anyway"
    fi

    mkdir -p var/cache var/log 2>/dev/null || true

    # Wait for Postgres when a DATABASE_URL is configured. depends_on already
    # gates on the healthcheck, but this keeps `docker compose run` usable too.
    if [ -n "${DATABASE_URL:-}" ]; then
        for _ in $(seq 1 30); do
            if pg_isready -h "${DATABASE_HOST:-database}" -p "${DATABASE_PORT:-5432}" -q; then
                break
            fi
            echo "[entrypoint] waiting for database..."
            sleep 1
        done
    fi

    # Only the php-fpm container generates the keypair: both containers share
    # the same bind-mounted config/jwt/, and two concurrent openssl runs would
    # race and could leave a private/public pair that does not match.
    if [ "$1" != "worker" ]; then
        generate_jwt_keys
    fi

    # Cache reconstruit AVANT tout le reste de ce bloc qui touche au noyau
    # Symfony (migrations ci-dessous) et, surtout, avant le `exec` final : au
    # moment où php-fpm accepte sa première requête, le cache est complet et
    # correspond au code réellement présent. Voir warm_cache() plus haut.
    #
    # Un échec est FATAL et non silencieux : démarrer sans cache valide, c'est
    # exactement la panne partielle qu'on cherche à éliminer.
    if ! warm_cache; then
        echo "[entrypoint] le warmup du cache a échoué -> arrêt" >&2
        exit 1
    fi

    # Le contrat ne concerne que le rôle HTTP : c'est là que l'absence d'une
    # route se traduit par un 404 muet pour l'utilisateur. Un worker ou une
    # commande ponctuelle n'ont pas à refuser de démarrer pour ça.
    if [ "$1" = "php-fpm" ]; then
        if ! assert_startup_contract; then
            exit 1
        fi
    fi

    # Opt-in schema migration. Disabled by default (RUN_MIGRATIONS=0) so that
    # `docker compose up` never mutates an existing schema implicitly.
    if [ "${RUN_MIGRATIONS:-0}" = "1" ] && [ -f bin/console ] && [ "$1" != "worker" ]; then
        if php bin/console list doctrine:migrations --no-ansi >/dev/null 2>&1; then
            echo "[entrypoint] RUN_MIGRATIONS=1 -> doctrine:migrations:migrate"
            php bin/console doctrine:migrations:migrate \
                --no-interaction --allow-no-migration || \
                echo "[entrypoint] migration failed, continuing anyway"
        fi
    fi
fi

# `worker` is a pseudo-command handled entirely by this script.
if [ "$1" = "worker" ]; then
    run_messenger_worker
    exit $?
fi

exec "$@"
