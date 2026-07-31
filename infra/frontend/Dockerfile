# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# manga-stream :: frontend (React + TypeScript + Vite)
# Build context : ./frontend       (see docker-compose.yml)
# Extra context : infra -> ./infra (named build context, provides nginx conf)
#
#   target: dev  -> vite dev server on :5173 with HMR, source bind-mounted
#   target: prod -> static build served by nginx with SPA fallback
# ---------------------------------------------------------------------------

FROM node:24-alpine AS base

ENV NODE_ENV=development \
    npm_config_update_notifier=false \
    npm_config_fund=false

WORKDIR /app

# ---------------------------------------------------------------------------
# deps : install node_modules from the lockfile only (best layer caching)
# ---------------------------------------------------------------------------
FROM base AS deps

# Escape hatch for an unresolved peer-dependency conflict in package.json.
# Set NPM_INSTALL_FLAGS=--legacy-peer-deps in .env to unblock a build while the
# real fix (aligning the offending version range) lands. Keep it EMPTY by
# default: a green build on a broken dependency graph is worse than a red one.
ARG NPM_INSTALL_FLAGS=""

# package-lock.json may not exist yet on a fresh scaffold -> the glob keeps
# the COPY valid either way, and the install falls back to `npm install`.
COPY package.json package-lock.json* ./

RUN if [ -f package-lock.json ]; then \
        npm ci ${NPM_INSTALL_FLAGS}; \
    else \
        echo "[frontend] no package-lock.json -> npm install"; \
        npm install ${NPM_INSTALL_FLAGS}; \
    fi

# ---------------------------------------------------------------------------
# dev : vite dev server. The source tree is bind-mounted by docker-compose,
#       node_modules lives in an anonymous/named volume so the host tree is
#       never shadowed by (and never shadows) the container install.
# ---------------------------------------------------------------------------
FROM deps AS dev

ENV NODE_ENV=development \
    CHOKIDAR_USEPOLLING=true \
    VITE_HMR_HOST=localhost

COPY --from=infra --chmod=0755 frontend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# The `deps` stage installs as root, and docker seeds the named volume mounted
# on /app/node_modules from THIS image directory — ownership included. Without
# the chown the volume ends up root-owned while the process runs as `node`, and
# Vite dies with "EACCES: permission denied, mkdir /app/node_modules/.vite".
# .vite must exist beforehand so it is part of the volume seed too.
RUN mkdir -p /app/node_modules/.vite /home/node/.npm \
    && chown -R node:node /app /home/node

USER node

EXPOSE 5173

ENTRYPOINT ["docker-entrypoint.sh"]
# --host binds 0.0.0.0 so the dev server is reachable from outside the container
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]

# ---------------------------------------------------------------------------
# build : type-check + vite production build -> /app/dist
# ---------------------------------------------------------------------------
FROM deps AS build

ENV NODE_ENV=development

COPY . .

# Build-time public vars (Vite inlines VITE_* at build time, not at runtime).
ARG VITE_API_URL=/api
ARG VITE_MERCURE_URL=http://localhost:3000/.well-known/mercure
ARG VITE_USE_MOCKS=false
ENV VITE_API_URL=${VITE_API_URL} \
    VITE_MERCURE_URL=${VITE_MERCURE_URL} \
    VITE_USE_MOCKS=${VITE_USE_MOCKS}

RUN npm run build

# ---------------------------------------------------------------------------
# prod : nginx alpine serving the static bundle with SPA history fallback
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS prod

COPY --from=infra nginx/frontend-prod.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
    CMD wget -q --spider http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
