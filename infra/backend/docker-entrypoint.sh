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
    [ -f config/jwt/private.pem ] && [ -f config/jwt/public.pem ] && return 0

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
