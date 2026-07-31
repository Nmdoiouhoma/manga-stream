#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# manga-stream :: backend container entrypoint
#
# In dev the source tree is bind-mounted, so `vendor/` may not exist yet on a
# fresh clone. We install dependencies once, then hand over to php-fpm.
# ---------------------------------------------------------------------------
set -e

cd /var/www/html

if [ "${1#-}" != "$1" ]; then
    # Allow `docker compose run backend -v` style invocations.
    set -- php-fpm "$@"
fi

if [ "$1" = "php-fpm" ] || [ "$1" = "php" ] || [ "$1" = "composer" ]; then

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

    # Opt-in schema migration. Disabled by default (RUN_MIGRATIONS=0) so that
    # `docker compose up` never mutates an existing schema implicitly.
    if [ "${RUN_MIGRATIONS:-0}" = "1" ] && [ -f bin/console ]; then
        if php bin/console list doctrine:migrations --no-ansi >/dev/null 2>&1; then
            echo "[entrypoint] RUN_MIGRATIONS=1 -> doctrine:migrations:migrate"
            php bin/console doctrine:migrations:migrate \
                --no-interaction --allow-no-migration || \
                echo "[entrypoint] migration failed, continuing anyway"
        fi
    fi
fi

exec "$@"
