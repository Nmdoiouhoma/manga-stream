#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# manga-stream :: mint a Mercure JWT (HS256)
#
# DEVELOPMENT AND TESTING TOOL. In the real flow the BACKEND mints the
# subscriber token and hands it to the browser (see README, "Mercure : JWT
# abonné"). This script exists so that:
#
#   * a developer can unblock themselves the day the hub closes anonymous
#     subscriptions but the backend endpoint is not merged yet;
#   * the negative test ("subscriber A must not receive B's events") can be
#     run for real, from a shell, without any application code.
#
# Usage:
#   infra/mercure/mint-jwt.sh subscribe /api/users/1/notifications
#   infra/mercure/mint-jwt.sh subscribe '/api/users/1/{topic}' /public/news
#   infra/mercure/mint-jwt.sh publish '*'
#
# Options:
#   -s, --secret SECRET   HS256 key. Default: $MERCURE_JWT_SECRET, else the
#                         placeholder from .env.example.
#   -t, --ttl SECONDS     Token lifetime. Default 3600. 0 = no `exp` claim.
#   -f, --format FORMAT   token (default) | cookie | header | curl
#
# The secret must be EXACTLY the one the hub runs with, otherwise the hub
# answers 401 and the token looks broken for no visible reason:
#   docker compose exec mercure printenv MERCURE_SUBSCRIBER_JWT_KEY
# ---------------------------------------------------------------------------
set -euo pipefail

DEFAULT_SECRET='!ChangeThisMercureHubJWTSecretKey!'

usage() {
    sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
    exit "${1:-0}"
}

secret="${MERCURE_JWT_SECRET:-$DEFAULT_SECRET}"
ttl=3600
format=token
role=""
topics=()

while [ $# -gt 0 ]; do
    case "$1" in
        -s|--secret) secret="$2"; shift 2 ;;
        -t|--ttl)    ttl="$2";    shift 2 ;;
        -f|--format) format="$2"; shift 2 ;;
        -h|--help)   usage 0 ;;
        subscribe|publish)
            if [ -n "$role" ]; then topics+=("$1"); else role="$1"; fi
            shift ;;
        --) shift; topics+=("$@"); break ;;
        -*) echo "unknown option: $1" >&2; usage 1 ;;
        *)  topics+=("$1"); shift ;;
    esac
done

[ -n "$role" ] || { echo "error: first argument must be 'subscribe' or 'publish'" >&2; usage 1; }
[ ${#topics[@]} -gt 0 ] || { echo "error: at least one topic is required" >&2; usage 1; }

command -v openssl >/dev/null 2>&1 || { echo "error: openssl is required" >&2; exit 1; }

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

# JSON array of the topics, with the few characters that matter escaped.
json_topics=""
for t in "${topics[@]}"; do
    escaped=${t//\\/\\\\}
    escaped=${escaped//\"/\\\"}
    json_topics="${json_topics}${json_topics:+,}\"${escaped}\""
done

# A token carrying ONLY `subscribe` cannot publish, and vice versa: the hub
# checks the matching claim for each operation. Keeping the two roles separate
# is the whole point — the browser must never hold a publisher token.
claims="\"${role}\":[${json_topics}]"
payload="{\"mercure\":{${claims}}"
if [ "$ttl" -gt 0 ]; then
    payload="${payload},\"exp\":$(( $(date +%s) + ttl ))"
fi
payload="${payload}}"

header='{"alg":"HS256","typ":"JWT"}'

h=$(printf '%s' "$header"  | b64url)
p=$(printf '%s' "$payload" | b64url)
sig=$(printf '%s' "${h}.${p}" | openssl dgst -sha256 -hmac "$secret" -binary | b64url)
jwt="${h}.${p}.${sig}"

case "$format" in
    token)  printf '%s\n' "$jwt" ;;
    cookie) printf 'mercureAuthorization=%s\n' "$jwt" ;;
    header) printf 'Authorization: Bearer %s\n' "$jwt" ;;
    curl)   printf -- '--cookie "mercureAuthorization=%s"\n' "$jwt" ;;
    *)      echo "unknown format: $format (token|cookie|header|curl)" >&2; exit 1 ;;
esac
