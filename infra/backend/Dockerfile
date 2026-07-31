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
    && mkdir -p /var/www/html /composer \
    && chown -R ${UID}:${GID} /var/www/html /composer /home/app

ENV COMPOSER_HOME=/composer \
    COMPOSER_ALLOW_SUPERUSER=0 \
    COMPOSER_MEMORY_LIMIT=-1 \
    PATH="/var/www/html/vendor/bin:${PATH}"

WORKDIR /var/www/html

COPY --from=infra --chmod=0755 backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

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
# ---------------------------------------------------------------------------
FROM base AS prod

ENV APP_ENV=prod \
    APP_DEBUG=0

COPY --chown=app:app composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-interaction --prefer-dist --no-progress \
    && composer clear-cache

COPY --chown=app:app . .

RUN composer dump-autoload --classmap-authoritative --no-dev \
    && mkdir -p var/cache var/log
