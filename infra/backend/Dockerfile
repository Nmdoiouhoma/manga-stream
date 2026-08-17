# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# manga-stream :: backend (Symfony / PHP-FPM)
# Build context : ./backend        (see docker-compose.yml)
# Extra context : infra -> ./infra (named build context, provides php ini files)
# ---------------------------------------------------------------------------

FROM php:8.4-fpm-alpine AS base

ARG UID=1000
ARG GID=1000

# --- system deps -----------------------------------------------------------
RUN apk add --no-cache \
        bash \
        git \
        icu-data-full \
        postgresql-client \
        unzip

# --- PHP extensions --------------------------------------------------------
# install-php-extensions handles the build deps (autoconf, gcc, headers...)
# and cleans up after itself.
COPY --from=mlocati/php-extension-installer:latest /usr/bin/install-php-extensions /usr/local/bin/
RUN install-php-extensions \
        pdo_pgsql \
        intl \
        opcache \
        zip \
    && rm -rf /tmp/*

# --- composer --------------------------------------------------------------
COPY --from=composer/composer:2-bin /composer /usr/bin/composer

# --- php configuration -----------------------------------------------------
COPY --from=infra backend/php/php.ini      /usr/local/etc/php/conf.d/zz-manga-stream.ini
COPY --from=infra backend/php/php-fpm.conf /usr/local/etc/php-fpm.d/zz-manga-stream.conf

# --- non-root user ---------------------------------------------------------
# php:fpm-alpine ships www-data as uid 82. We create a dedicated `app` user
# aligned on the host uid/gid so bind-mounted files stay writable.
RUN addgroup -g ${GID} -S app 2>/dev/null || true \
    && adduser -u ${UID} -S -D -G app -h /home/app -s /bin/bash app 2>/dev/null || true \
    && mkdir -p /var/www/html /composer /state \
    && chown -R ${UID}:${GID} /var/www/html /composer /home/app /state

ENV COMPOSER_HOME=/composer \
    COMPOSER_ALLOW_SUPERUSER=0 \
    COMPOSER_MEMORY_LIMIT=-1 \
    PATH="/var/www/html/vendor/bin:${PATH}"

WORKDIR /var/www/html

COPY --from=infra --chmod=0755 backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# NOTE sur /state (créé et donné à `app` plus haut) : c'est le point de montage
# du volume `anilist_sync_state` du service `cron`. Quand docker initialise un
# volume nommé VIDE, il recopie le contenu ET les droits du répertoire présent
# à cet emplacement dans l'image. Sans ce mkdir/chown, le volume naîtrait
# root:root et le processus `app` ne pourrait rien y écrire : le planificateur
# perdrait son état à chaque redémarrage, ce qui lui retire sa seule raison
# d'être.
#
# Pas de directive VOLUME ici, volontairement : elle s'appliquerait aussi aux
# services `backend` et `worker`, qui hériteraient chacun d'un volume anonyme
# inutile à nettoyer à la main.

USER app

EXPOSE 9000

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["php-fpm"]

# ---------------------------------------------------------------------------
# dev : the source tree is bind-mounted by docker-compose, nothing is baked in.
# ---------------------------------------------------------------------------
FROM base AS dev

ENV APP_ENV=dev \
    APP_DEBUG=1

# ---------------------------------------------------------------------------
# prod : source code + optimized autoloader baked into the image.
#
# Le cache Symfony n'est PAS construit ici, volontairement — voir la note
# « POURQUOI PAS DE cache:warmup AU BUILD » en bas de fichier.
# ---------------------------------------------------------------------------
FROM base AS prod

ENV APP_ENV=prod \
    APP_DEBUG=0

# Surcharges dimensionnées pour la t3.micro à 908 Mo. Préfixe `zzz-` : elles
# sont lues APRÈS les `zz-` du stage `base`, donc elles gagnent. Le stage `dev`
# ne les reçoit pas et garde des réglages confortables.
USER root
COPY --from=infra backend/php/php-prod.ini      /usr/local/etc/php/conf.d/zzz-manga-stream-prod.ini
COPY --from=infra backend/php/php-fpm-prod.conf /usr/local/etc/php-fpm.d/zzz-manga-stream-prod.conf
USER app

COPY --chown=app:app composer.json composer.lock ./
# Repli sur `--prefer-source` si les archives ne descendent pas. Vécu le
# 2026-08-17 depuis l'EC2 : `codeload.github.com` répond 429 à toute demande
# anonyme venant de cette IP — pendant que `api.github.com` sert ses 60
# requêtes et qu'un `git clone` passe en une seconde. Le build échouait donc
# sur la première dépendance venue, sans que rien ne soit cassé côté code.
# Les clones sont plus lents et laissent un `.git` par paquet, mais
# composer.lock fige les mêmes révisions : le vendor obtenu est identique.
# Le secret `composer_auth` est FACULTATIF : sans lui, la variable reste vide et
# Composer télécharge en anonyme, comme avant. Avec lui — un JSON de la forme
# {"github-oauth":{"github.com":"ghp_…"}} — la limite anonyme de GitHub saute.
# Passé par `--mount=type=secret`, il n'apparaît dans aucune couche de l'image
# ni dans `docker history`. Construire avec :
#   docker build --secret id=composer_auth,src=/chemin/auth.json …
# `mode=0444` parce que ce stage tourne en `app` : monté par défaut, le fichier
# appartient à root en 0400 et l'utilisateur ne peut pas le lire. Et on lit le
# fichier plutôt que d'utiliser `env=`, réservé au frontend Dockerfile 1.10+
# alors que ce fichier est épinglé en 1.7.
RUN --mount=type=secret,id=composer_auth,mode=0444 \
    { [ -s /run/secrets/composer_auth ] \
      && export COMPOSER_AUTH="$(cat /run/secrets/composer_auth)" || true; } \
    && { composer install --no-dev --no-scripts --no-interaction --prefer-dist --no-progress \
    || composer install --no-dev --no-scripts --no-interaction --prefer-source --no-progress; } \
    && composer clear-cache

# Ce `COPY .` est filtré par infra/backend/Dockerfile.dockerignore : sans lui,
# il embarquerait var/cache/, vendor/, .env.local et config/jwt/*.pem de la
# machine qui construit. Lire ce fichier avant de toucher à cette ligne.
COPY --chown=app:app . .

# Ceinture ET bretelles. Le .dockerignore ci-dessus suffit AVEC BuildKit
# (docker >= 23) ; un constructeur plus ancien, ou un `docker build` lancé
# depuis un autre répertoire, l'ignorerait sans le moindre avertissement — et
# l'image repartirait avec le cache périmé de l'hôte. Ces quelques secondes de
# build achètent la garantie que l'image ne contient QUE ce qu'on y a mis :
#
#   * var/cache, var/log : reconstruits au démarrage par l'entrypoint ;
#   * .env.local : surcharges de poste de développement ;
#   * config/jwt : clés privées, générées au démarrage et persistées dans le
#     volume `jwt_keys` ;
#   * `composer install` rejoué : réinstalle exactement composer.lock SANS les
#     dépendances de développement, donc désinstalle ce qu'un vendor/ d'hôte
#     aurait pu apporter, et regénère un autoloader `classmap-authoritative`.
RUN rm -rf var/cache var/log .env.local .env.*.local config/jwt \
             tests .phpunit.cache phpunit.xml \
    && composer install --no-dev --no-scripts --no-interaction --prefer-dist \
             --no-progress --classmap-authoritative \
    && composer clear-cache \
    && mkdir -p var/cache var/log config/jwt

# ---------------------------------------------------------------------------
# POURQUOI PAS DE cache:warmup AU BUILD
#
# C'est la question qui a coûté le plus cher sur ce projet. Trois façons de
# faire, une seule qui tient :
#
#   1. Cache hérité du contexte de build (l'état d'AVANT, par accident) :
#      l'image partait avec le cache de la machine du développeur. En prod
#      APP_DEBUG=0, Symfony ne vérifie PAS la fraîcheur du conteneur compilé —
#      il le charge tel quel. Les routes de src/ApiResource/ ajoutées après la
#      génération de ce cache répondaient 404 pendant que le catalogue
#      fonctionnait : panne partielle, silencieuse, très coûteuse à diagnostiquer.
#
#   2. `cache:warmup` ici, au build : mieux, mais le cache produit reflète
#      l'environnement du CONSTRUCTEUR, pas celui de l'exécution. Le même
#      artefact sert aujourd'hui à docker-compose.prod.yml et à la surcouche
#      tunnel, avec des DEFAULT_URI, MERCURE_URL et CORS différents. Et surtout
#      ça ne protège de rien : il suffit qu'une couche ultérieure, un volume ou
#      un bind-mount recouvre var/cache pour retomber sur le cas 1.
#
#   3. `cache:warmup` À L'ENTRYPOINT, après un `rm -rf var/cache/$APP_ENV`
#      (choix retenu, voir infra/backend/docker-entrypoint.sh). C'est le seul
#      endroit où le cache ne PEUT PAS être périmé : il est construit à partir
#      du code réellement présent et des variables réellement injectées, par un
#      processus unique, AVANT que php-fpm n'accepte la première requête.
#      Ce dernier point compte autant que le reste : sans warmup explicite, un
#      cache vide se remplit paresseusement à la première requête, et une
#      rafale initiale fait compiler plusieurs enfants php-fpm en concurrence —
#      c'est le second chemin, indépendant du premier, vers un cache incomplet.
#
# Coût mesuré du choix 3 sur une t3.micro (908 Mo) : quelques secondes ajoutées
# au démarrage du conteneur, une seule fois. À comparer à une inscription et
# une connexion muettes après le prochain reboot AWS.
# ---------------------------------------------------------------------------
