# infra/

Toute l'infrastructure de `manga-stream`. Aucun fichier Docker ne vit dans
`backend/` ou `frontend/` : les Dockerfiles sont ici et sont référencés depuis
le `docker-compose.yml` racine.

```
infra/
├── backend/
│   ├── Dockerfile              # PHP 8.4-FPM alpine (stages: base, dev, prod)
│   ├── docker-entrypoint.sh    # composer install auto + attente de la base
│   └── php/
│       ├── php.ini             # limites, opcache, realpath cache
│       └── php-fpm.conf        # pool www : listen 9000, clear_env=no
├── frontend/
│   ├── Dockerfile              # Node 24 (stages: base, deps, dev, build, prod)
│   └── docker-entrypoint.sh    # npm install auto si node_modules est vide
└── nginx/
    ├── default.conf            # vhost backend Symfony -> php-fpm
    └── frontend-prod.conf      # vhost SPA statique (fallback index.html)
```

---

## Les services

| Service    | Image / build                    | Hostname interne | Port interne | Port hôte |
| ---------- | -------------------------------- | ---------------- | ------------ | --------- |
| `database` | `postgres:16-alpine`             | `database`       | 5432         | **5432**  |
| `backend`  | `infra/backend/Dockerfile` (dev) | `backend`        | 9000 (FPM)   | —         |
| `nginx`    | `nginx:1.27-alpine`              | `nginx`          | 80           | **8000**  |
| `frontend` | `infra/frontend/Dockerfile` (dev)| `frontend`       | 5173         | **5173**  |
| `mercure`  | `dunglas/mercure:latest`         | `mercure`        | 80           | **3000**  |

Tous les conteneurs partagent le réseau bridge `manga-stream`. **Depuis un
conteneur, on s'adresse aux autres par leur nom de service**, jamais par
`localhost`.

### `database`

PostgreSQL 16. Données persistées dans le volume nommé `database_data`.
Healthcheck `pg_isready` : `backend` attend `service_healthy` avant de
démarrer. Identifiants de dev : `manga` / `manga`, base `manga_stream`.

Chaîne de connexion **depuis un conteneur** :

```
postgresql://manga:manga@database:5432/manga_stream?serverVersion=16&charset=utf8
```

Depuis la machine hôte (client SQL, TablePlus…) : `localhost:5432`.

### `backend`

PHP 8.4-FPM alpine avec `pdo_pgsql`, `intl`, `opcache`, `zip`, plus Composer.
Tourne en **utilisateur non-root** (`app`, uid/gid alignés sur l'hôte via les
build args `UID`/`GID`).

Le code est monté depuis `./backend`, rien n'est figé dans l'image en dev.
L'entrypoint installe `vendor/` automatiquement s'il manque, puis attend que
Postgres réponde. Le cache Composer vit dans le volume `composer_cache`, donc
il survit aux reconstructions.

Le service n'expose **aucun port** : PHP-FPM parle le protocole FastCGI, il
faut passer par `nginx`.

Les migrations Doctrine ne sont **pas** jouées automatiquement, pour qu'un
`docker compose up` ne modifie jamais un schéma existant à l'insu de l'équipe.
Pour les activer au démarrage du conteneur : `RUN_MIGRATIONS=1` dans `.env`.
Sinon, manuellement :

```bash
docker compose exec backend php bin/console doctrine:migrations:migrate --no-interaction
```

Le stage `prod` du même Dockerfile copie le code dans l'image et génère un
autoloader optimisé (`--classmap-authoritative`).

### `nginx`

Front controller Symfony : tout ce qui n'est pas un fichier réel part vers
`index.php`, et aucun autre `.php` n'est exécutable.

Deux endpoints de santé sont exposés : `/nginx-health` (nginx seul) et
`/fpm-ping` (chaîne complète nginx → PHP-FPM, répond `pong` même sans aucune
route Symfony définie — c'est celui qu'utilise le healthcheck compose ; sonder
`/` renverrait un 404 parfaitement légitime et ferait passer le conteneur pour
malade à tort).

Proxifie également
`/.well-known/mercure` vers le hub afin de pouvoir servir l'API et le SSE
depuis la même origine en production (buffering désactivé, timeout 24 h pour
garder les connexions SSE ouvertes).

Le code backend est monté en lecture seule : nginx en a besoin pour résoudre
`$realpath_root` et servir les fichiers statiques de `public/`.

### `frontend`

Serveur de dev Vite lancé avec `--host 0.0.0.0` (sans quoi il n'écouterait que
sur la boucle locale du conteneur et resterait injoignable depuis l'hôte).
Le code est monté depuis `./frontend`, mais `node_modules` est isolé dans le
volume `frontend_node_modules` : les binaires natifs compilés pour alpine ne
doivent pas écraser ceux de macOS et inversement.

Le stage `prod` construit le bundle (`tsc -b && vite build`) et le sert avec
nginx : assets hashés en cache immuable, `index.html` jamais mis en cache, et
fallback SPA `try_files $uri /index.html`.

### `mercure`

Hub SSE basé sur Caddy.

> **Piège classique** : sans `SERVER_NAME=":80"`, Caddy tente de provisionner
> un certificat TLS pour `localhost` et le hub n'est jamais joignable en HTTP.
> Le `:` initial est indispensable.

Configuration en dev, via `MERCURE_EXTRA_DIRECTIVES` :

- `transport bolt { path /data/mercure.db }` — persistance dans le volume
  `mercure_data` (le hub peut ainsi rejouer les messages manqués via
  `Last-Event-ID`) ;
- `cors_origins` — autorise `http://localhost:5173` (Vite) et
  `http://localhost:8000` ;
- `anonymous` — **dev uniquement**, permet au navigateur de s'abonner sans JWT ;
- `demo` — **dev uniquement**, expose le debugger sur
  http://localhost:3000/.well-known/mercure/ui/ ;
- `subscriptions` — active l'API de suivi des abonnements.

Publisher et subscriber partagent le même secret HS256
(`MERCURE_JWT_SECRET`). En production : retirer `anonymous` et `demo`, et
utiliser deux clés distinctes.

---

## Démarrer

```bash
cp .env.example .env
docker compose up -d              # toute la stack
docker compose up -d database mercure   # juste l'infra sans le code applicatif
docker compose ps                 # vérifier les healthchecks
docker compose down               # arrêt, volumes conservés
```

Reconstruire après modification d'un Dockerfile :

```bash
docker compose build --no-cache backend
docker compose up -d --force-recreate backend
```

Construire et tester l'image frontend de production :

```bash
docker build -f infra/frontend/Dockerfile --target prod \
  --build-context infra=./infra -t manga-stream-frontend:prod ./frontend
docker run --rm -p 8080:80 manga-stream-frontend:prod
```

---

## Note : `additional_contexts`

Les Dockerfiles vivent dans `infra/` mais le contexte de build est `./backend`
ou `./frontend`. Pour que ces Dockerfiles puissent quand même copier des
fichiers de configuration situés dans `infra/`, le compose déclare un contexte
de build nommé :

```yaml
build:
  context: ./backend
  dockerfile: ../infra/backend/Dockerfile
  additional_contexts:
    infra: ./infra
```

d'où les `COPY --from=infra …` dans les Dockerfiles. Cela nécessite BuildKit
(actif par défaut avec Docker 23+). En build manuel, l'équivalent CLI est
`--build-context infra=./infra`.

---

## Dépannage

| Symptôme | Cause probable |
| -------- | -------------- |
| `mercure` boucle au démarrage / injoignable | `SERVER_NAME` ne vaut pas `:80` → Caddy tente du HTTPS |
| Le frontend ne répond pas sur 5173 | Vite lancé sans `--host` |
| `EACCES ... mkdir /app/node_modules/.vite` | Le volume `frontend_node_modules` a été semé root alors que le process tourne en `node`. Corrigé par le `chown` du stage `dev` ; si le volume est antérieur au correctif : `docker compose down frontend && docker volume rm manga-stream_frontend_node_modules` puis rebuild |
| `npm ci` échoue en `ERESOLVE` | Conflit de peer dependency dans `frontend/package.json` (à corriger là-bas). Dépannage temporaire : `NPM_INSTALL_FLAGS=--legacy-peer-deps` dans `.env` |
| `nginx` marqué `unhealthy` alors que le site répond | Le healthcheck accepte tout statut < 500 ; un `unhealthy` signifie un vrai 5xx (php-fpm KO), voir `docker compose logs backend` |
| `Connection refused` vers la base côté backend | `DATABASE_URL` pointe sur `localhost` au lieu de `database` |
| `502 Bad Gateway` sur :8000 | Le conteneur `backend` n'a pas fini son `composer install` — voir `docker compose logs backend` |
| Symfony ne voit pas les variables d'env | `clear_env = no` manquant dans le pool PHP-FPM |
| EventSource bloqué par CORS | Origine absente de `cors_origins` dans `MERCURE_EXTRA_DIRECTIVES` |
| Port déjà utilisé | Surcharger `BACKEND_PORT` / `FRONTEND_PORT` / `MERCURE_PORT` / `POSTGRES_PORT` dans `.env` |
