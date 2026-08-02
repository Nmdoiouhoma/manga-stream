#!/bin/sh
# ---------------------------------------------------------------------------
# manga-stream :: Mercure hub entrypoint
#
# Why a wrapper instead of writing MERCURE_EXTRA_DIRECTIVES straight into
# docker-compose.yml?
#
#   The `anonymous` directive is a single line that must be present or absent.
#   Compose interpolation only knows `${VAR:-default}` — it cannot express
#   "add this line only if the flag is true". Encoding a security decision as
#   "paste the right string into the right variable" is exactly how holes get
#   left open by accident, so the decision lives here, in one readable `if`.
#
# The image ships no ENTRYPOINT, only
#   CMD ["caddy","run","--config","/etc/caddy/Caddyfile","--adapter","caddyfile"]
# so compose overrides `entrypoint` and the upstream CMD is passed to us
# untouched: we never hardcode the caddy command line and never drift from it.
#
# Knobs (all read from the environment, see .env.example):
#   MERCURE_ALLOW_ANONYMOUS  false (default) | true  -- open subscriptions
#   MERCURE_DEMO_UI          false (default) | true  -- /.well-known/mercure/ui/
#   MERCURE_CORS_ORIGINS     space separated origins allowed to subscribe
#   MERCURE_PUBLISH_ORIGINS  space separated origins allowed to publish
#   MERCURE_SUBSCRIPTIONS    true (default) | false -- subscription API
#   MERCURE_TRANSPORT_PATH   bolt database path
# ---------------------------------------------------------------------------
set -eu

log() { echo "[mercure-entrypoint] $*" >&2; }

allow_anonymous="${MERCURE_ALLOW_ANONYMOUS:-false}"
demo_ui="${MERCURE_DEMO_UI:-false}"
subscriptions="${MERCURE_SUBSCRIPTIONS:-true}"
transport_path="${MERCURE_TRANSPORT_PATH:-/data/mercure.db}"
cors_origins="${MERCURE_CORS_ORIGINS:-http://localhost:5173 http://127.0.0.1:5173 http://localhost:8000}"
publish_origins="${MERCURE_PUBLISH_ORIGINS:-http://localhost:5173 http://localhost:8000 http://localhost:3000}"

directives="transport bolt {
  path ${transport_path}
}
cors_origins ${cors_origins}
publish_origins ${publish_origins}"

# ---------------------------------------------------------------------------
# Anonymous subscriptions
#
# With `anonymous`, ANY browser can open an EventSource on ANY topic, including
# /api/users/<someone else>/notifications. As soon as the backend publishes
# per-user payloads that is a data leak, not a theoretical one. Closing it
# means every subscriber must present a JWT whose `mercure.subscribe` claim
# lists the topics it is allowed to read — the hub then filters per connection.
# ---------------------------------------------------------------------------
case "$allow_anonymous" in
    1|true|TRUE|True|yes|on)
        directives="${directives}
anonymous"
        log "WARNING: MERCURE_ALLOW_ANONYMOUS=${allow_anonymous} -> anonymous subscriptions are ENABLED."
        log "WARNING: any browser can subscribe to any topic, including other users' ones."
        log "WARNING: development escape hatch only. Never set this in a deployed environment."
        ;;
    *)
        log "anonymous subscriptions DISABLED -> subscribers must send a JWT carrying mercure.subscribe"
        ;;
esac

# The demo UI (/.well-known/mercure/ui/) is a debugging console. It cannot
# bypass authorization, but it is one more unauthenticated surface: off unless
# explicitly asked for.
case "$demo_ui" in
    1|true|TRUE|True|yes|on)
        directives="${directives}
demo"
        log "demo UI enabled on /.well-known/mercure/ui/"
        ;;
esac

case "$subscriptions" in
    0|false|FALSE|False|no|off) : ;;
    *)
        directives="${directives}
subscriptions"
        ;;
esac

if [ -n "${MERCURE_EXTRA_DIRECTIVES_APPEND:-}" ]; then
    directives="${directives}
${MERCURE_EXTRA_DIRECTIVES_APPEND}"
fi

MERCURE_EXTRA_DIRECTIVES="$directives"
export MERCURE_EXTRA_DIRECTIVES

# ---------------------------------------------------------------------------
# Loud check on the shared HS256 secret. This repository is public and ships a
# placeholder value; signing real subscriber tokens with a secret everyone can
# read is the same as having no authorization at all.
# ---------------------------------------------------------------------------
default_secret='!ChangeThisMercureHubJWTSecretKey!'
if [ "${MERCURE_PUBLISHER_JWT_KEY:-}" = "$default_secret" ] || \
   [ "${MERCURE_SUBSCRIBER_JWT_KEY:-}" = "$default_secret" ]; then
    log "NOTE: the hub still uses the public placeholder JWT secret."
    log "NOTE: fine locally, unacceptable anywhere else -> set MERCURE_JWT_SECRET in .env."
fi

log "effective directives:"
printf '%s\n' "$MERCURE_EXTRA_DIRECTIVES" | sed 's/^/[mercure-entrypoint]   /' >&2

exec "$@"
