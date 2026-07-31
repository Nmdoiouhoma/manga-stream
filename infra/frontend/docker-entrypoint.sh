#!/bin/sh
# ---------------------------------------------------------------------------
# manga-stream :: frontend dev container entrypoint
#
# The host source tree is bind-mounted over /app, so package.json changes made
# by the host are visible here. Re-run the install when node_modules is empty
# or when the lockfile is newer than the installed tree.
# ---------------------------------------------------------------------------
set -e

cd /app

if [ -f package.json ]; then
    if [ ! -d node_modules ] || [ -z "$(ls -A node_modules 2>/dev/null)" ]; then
        echo "[entrypoint] node_modules empty -> installing dependencies"
        if [ -f package-lock.json ]; then npm ci; else npm install; fi
    elif [ -f package-lock.json ] && [ package-lock.json -nt node_modules/.package-lock.json ]; then
        echo "[entrypoint] lockfile changed -> npm install"
        npm install
    fi
fi

exec "$@"
