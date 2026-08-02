#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# manga-stream :: Mercure authorization regression test
#
# Proves, against the RUNNING hub, that per-user topics are actually isolated.
# Run it after any change to the hub configuration:
#
#   infra/mercure/check-authorization.sh
#   MERCURE_BASE_URL=http://localhost:3000 infra/mercure/check-authorization.sh
#
# What it asserts
#   1. no JWT              -> subscribing is refused (401)
#   2. no JWT              -> publishing is refused (401)
#   3. subscriber token    -> publishing is still refused (wrong claim)
#   4. token scoped on A   -> receives A's PRIVATE update
#   5. token scoped on A   -> does NOT receive B's PRIVATE update   <-- the point
#   6. token scoped on A   -> DOES receive B's PUBLIC update
#
# Assertion 6 is not a bug, it is the Mercure model, and it is the trap that
# will bite this project: `mercure.subscribe` only gates updates published as
# PRIVATE. An update published without the private flag is broadcast to every
# connected subscriber whatever their claims. The backend therefore MUST send
# per-user notifications as private updates — see README, "Mercure : JWT
# abonné". This script fails loudly if that ever stops being true.
# ---------------------------------------------------------------------------
set -uo pipefail

BASE_URL="${MERCURE_BASE_URL:-http://localhost:${MERCURE_PORT:-3000}}"
HUB="${BASE_URL}/.well-known/mercure"
SECRET="${MERCURE_JWT_SECRET:-!ChangeThisMercureHubJWTSecretKey!}"
HERE="$(cd "$(dirname "$0")" && pwd)"
MINT="${HERE}/mint-jwt.sh"

TOPIC_A="${TOPIC_A:-/api/users/1/notifications}"
TOPIC_B="${TOPIC_B:-/api/users/2/notifications}"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"; [ -n "${SUB_PID:-}" ] && kill "$SUB_PID" 2>/dev/null' EXIT

pass=0
fail=0
ok()   { printf '  \033[32mPASS\033[0m %s\n' "$1"; pass=$((pass + 1)); }
ko()   { printf '  \033[31mFAIL\033[0m %s\n' "$1"; fail=$((fail + 1)); }
head1() { printf '\n== %s\n' "$1"; }

command -v curl >/dev/null || { echo "curl is required"; exit 1; }

echo "hub      : $HUB"
echo "topic A  : $TOPIC_A"
echo "topic B  : $TOPIC_B"

SUB_A=$("$MINT" subscribe "$TOPIC_A" --secret "$SECRET")
PUB=$("$MINT" publish '*' --secret "$SECRET")

# ---------------------------------------------------------------------------
# 1 & 2 : nothing works without a token
# ---------------------------------------------------------------------------
head1 "anonymous access is closed"

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 \
        "${HUB}?topic=$(printf '%s' "$TOPIC_A" | sed 's|/|%2F|g')")
[ "$code" = "401" ] && ok "subscribe without JWT -> 401" \
                    || ko "subscribe without JWT -> got $code, expected 401"

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 \
        -X POST "$HUB" --data-urlencode "topic=${TOPIC_A}" --data-urlencode 'data=x')
[ "$code" = "401" ] && ok "publish without JWT -> 401" \
                    || ko "publish without JWT -> got $code, expected 401"

# ---------------------------------------------------------------------------
# 3 : a subscriber token is not a publisher token
# ---------------------------------------------------------------------------
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 \
        -H "Authorization: Bearer ${SUB_A}" \
        -X POST "$HUB" --data-urlencode "topic=${TOPIC_A}" --data-urlencode 'data=x')
[ "$code" = "401" ] || [ "$code" = "403" ] \
    && ok "publish with a SUBSCRIBER token -> $code" \
    || ko "publish with a SUBSCRIBER token -> got $code, expected 401/403"

# ---------------------------------------------------------------------------
# 4/5/6 : one long-lived subscriber, three publications
#
# The subscriber deliberately asks for BOTH topics: a hostile client would.
# Authorization must be enforced by the hub, not by the client's politeness.
# ---------------------------------------------------------------------------
head1 "topic isolation (subscriber scoped on A, asking for A and B)"

STREAM="${WORKDIR}/stream.txt"
: > "$STREAM"

curl -sN --max-time 12 \
    --cookie "mercureAuthorization=${SUB_A}" \
    -G "$HUB" \
    --data-urlencode "topic=${TOPIC_A}" \
    --data-urlencode "topic=${TOPIC_B}" \
    > "$STREAM" 2>/dev/null &
SUB_PID=$!

sleep 2

publish() { # publish <topic> <data> [private]
    # `--data-urlencode private=on` only when asked. Written without an array
    # so the script also runs on the bash 3.2 shipped by macOS, where an empty
    # array expanded under `set -u` is an "unbound variable" error.
    if [ "${3:-}" = "private" ]; then
        curl -s -o /dev/null -w '%{http_code}' --max-time 5 \
            -H "Authorization: Bearer ${PUB}" \
            -X POST "$HUB" \
            --data-urlencode "topic=$1" \
            --data-urlencode "data=$2" \
            --data-urlencode 'private=on'
    else
        curl -s -o /dev/null -w '%{http_code}' --max-time 5 \
            -H "Authorization: Bearer ${PUB}" \
            -X POST "$HUB" \
            --data-urlencode "topic=$1" \
            --data-urlencode "data=$2"
    fi
}

c1=$(publish "$TOPIC_A" 'PRIVATE_FOR_A' private)
c2=$(publish "$TOPIC_B" 'PRIVATE_FOR_B' private)
c3=$(publish "$TOPIC_B" 'PUBLIC_ON_B')
echo "  (publish status: A-private=$c1 B-private=$c2 B-public=$c3)"

sleep 3
kill "$SUB_PID" 2>/dev/null
wait "$SUB_PID" 2>/dev/null
SUB_PID=""

echo "  --- raw stream received by subscriber A ---"
sed 's/^/  | /' "$STREAM"
echo "  -------------------------------------------"

grep -q 'PRIVATE_FOR_A' "$STREAM" \
    && ok "A receives its own private update" \
    || ko "A did NOT receive its own private update (is the backend able to publish at all?)"

grep -q 'PRIVATE_FOR_B' "$STREAM" \
    && ko "LEAK: A received B's private update" \
    || ok "A does NOT receive B's private update  <-- isolation holds"

grep -q 'PUBLIC_ON_B' "$STREAM" \
    && ok "A receives B's PUBLIC update (expected: public = broadcast, backend must publish private)" \
    || ko "A did not receive B's public update -- the Mercure model changed, re-read this script"

# ---------------------------------------------------------------------------
head1 "result"
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
