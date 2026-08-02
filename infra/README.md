# infra/

Toute l'infrastructure de `manga-stream` — le tracker de catalogue manga /
anime décrit dans le [README racine](../README.md). Aucun fichier Docker ne vit
dans `backend/` ou `frontend/` : les Dockerfiles sont ici et sont référencés
depuis le `docker-compose.yml` racine.

```
infra/
├── backend/
│   ├── Dockerfile              # PHP 8.4-FPM alpine (stages: base, dev, prod)
│   ├── docker-entrypoint.sh    # composer install auto, attente de la base,
│   │                           # génération des clés JWT, boucle du worker
│   └── php/
│       ├── php.ini             # limites, opcache, realpath cache
│       └── php-fpm.conf        # pool www : listen 9000, clear_env=no
├── frontend/
│   ├── Dockerfile              # Node 24 (stages: base, deps, dev, build, prod)
│   └── docker-entrypoint.sh    # npm install auto si node_modules est vide
├── nginx/
│   ├── default.conf            # vhost backend Symfony -> php-fpm
│   ├── frontend-prod.conf      # vhost SPA statique (fallback index.html)
│   └── security-headers.conf   # en-têtes de sécurité partagés
├── mercure/
│   ├── docker-entrypoint.sh    # calcule MERCURE_EXTRA_DIRECTIVES
│   ├── mint-jwt.sh             # forge un JWT publisher/subscriber
│   └── check-authorization.sh  # vérifie le modèle d'autorisation du hub
├── cron/
│   ├── docker-entrypoint.sh    # planificateur AniList, état persistant
│   ├── anilist-sync-status     # raccourci : dernière exécution
│   └── anilist-sync-now        # raccourci : forcer une synchro
├── caddy/
│   └── Caddyfile               # PRODUCTION : TLS Let's Encrypt, origine unique
└── backup/
    ├── pg-backup.sh            # dump PostgreSQL vérifié + rétention
    └── pg-restore.sh           # ESSAI de restauration, et restauration réelle
```

---

## Les services

| Service    | Image / build                    | Hostname interne | Port interne | Port hôte |
| ---------- | -------------------------------- | ---------------- | ------------ | --------- |
| `database` | `postgres:16-alpine`             | `database`       | 5432         | **5432**  |
| `backend`  | `infra/backend/Dockerfile` (dev) | `backend`        | 9000 (FPM)   | —         |
| `worker`   | même image que `backend`         | `worker`         | —            | —         |
| `cron`     | même image que `backend`         | `cron`           | —            | —         |
| `nginx`    | `nginx:1.27-alpine`              | `nginx`          | 80           | **8000**  |
| `frontend` | `infra/frontend/Dockerfile` (dev)| `frontend`       | 5173         | **5173**  |
| `mercure`  | `dunglas/mercure:latest`         | `mercure`        | 80           | **3000**  |
| `mailpit`  | `axllent/mailpit:latest`         | `mailpit`        | 1025 / 8025  | **1025 / 8025** |

En production s'ajoutent `caddy` (seul service publié, 80/443) et `backup`,
et `mailpit` disparaît — voir `docker-compose.prod.yml`.

Tous les conteneurs partagent le réseau bridge `manga-stream`. **Depuis un
conteneur, on s'adresse aux autres par leur nom de service**, jamais par
`localhost`.

### Le réseau n'est plus laissé au hasard

Le sous-réseau est **figé** (`DOCKER_SUBNET=172.21.0.0/16`) et nginx porte une
**adresse réservée** (`NGINX_IP=172.21.0.250`).

Ce n'est pas de la coquetterie : php-fpm ne voit que l'adresse du saut qui le
précède, et c'est cette adresse que Symfony doit reconnaître comme proxy de
confiance pour accepter de lire l'IP réelle du visiteur dans `X-Forwarded-For`
(`SYMFONY_TRUSTED_PROXIES`). Une adresse allouée dynamiquement change à chaque
recréation du conteneur, et la déclaration devient fausse **en silence** — avec
pour conséquence un limiteur de débit qui range tout le monde dans le même
compteur.

En cas de collision avec un autre réseau Docker de la machine (« Pool overlaps
with other one on this address space »), changer les deux valeurs de façon
cohérente dans `.env`, puis `docker compose down && docker compose up -d`. Les
volumes, donc la base, ne sont pas touchés.

> **Vécu, et à retenir.** Après un changement de configuration réseau, un
> simple `docker compose up -d` redémarre certains conteneurs sans les
> recréer — et ceux-là **perdent leur alias DNS de service**. Symptôme :
> `getent hosts database` ne renvoie plus rien depuis le backend, alors que
> l'IP répond parfaitement, et le backend boucle sur « waiting for
> database ». Le remède est un `docker compose up -d --force-recreate`, une
> fois.

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

L'entrypoint génère aussi, au premier démarrage, la paire RSA 4096 attendue par
`lexik/jwt-authentication-bundle` dans `backend/config/jwt/` si elle est
absente. Ce répertoire est gitignoré : **une clé privée publiée compromettrait
toute l'authentification**. `GENERATE_JWT_KEYS=0` désactive ce comportement.

Le stage `prod` du même Dockerfile copie le code dans l'image et génère un
autoloader optimisé (`--classmap-authoritative`).

### `worker`

Même image, même code, même environnement que `backend` (les deux services
partagent l'ancre YAML `x-backend-env` du `docker-compose.yml`), mais au lieu
de php-fpm il lance :

```bash
php bin/console messenger:consume async -vv --time-limit=3600 --memory-limit=128M
```

La commande passée au conteneur est simplement `worker` : ce n'est pas un
binaire, c'est une pseudo-commande interprétée par
`infra/backend/docker-entrypoint.sh`, qui exécute une **boucle de
supervision** :

1. le consumer s'arrête volontairement toutes les heures ou à 128 Mo (garde-fou
   classique contre les fuites mémoire d'un process PHP au long cours) — la
   boucle le relance immédiatement ;
2. avant chaque lancement, elle sonde `messenger:stats <transport>`. Si le
   transport n'est pas déclaré, ou si la table `messenger_messages` n'existe pas
   encore, elle **attend `MESSENGER_RETRY_DELAY` secondes et réessaie** au lieu
   de laisser le conteneur mourir : sans cela Docker le redémarrerait en boucle
   serrée, avec une stack trace complète à chaque tour ;
3. le message d'attente n'est journalisé qu'une fois puis toutes les 20
   tentatives, pour garder des logs lisibles ;
4. `SIGTERM` est intercepté et transmis au consumer, qui termine le message en
   cours avant de sortir (`stop_grace_period: 30s` côté compose).

Le service n'a **pas** de `container_name`, ce qui autorise
`docker compose up -d --scale worker=3`. Il n'a pas non plus de healthcheck :
un worker qui n'a rien à consommer est un worker en parfaite santé, et aucune
sonde bon marché ne distingue ce cas d'une panne. On le surveille avec
`docker compose logs -f worker`.

Réglages : `MESSENGER_CONSUME_TRANSPORTS` (défaut `async`),
`MESSENGER_TIME_LIMIT` (`3600`), `MESSENGER_MEMORY_LIMIT` (`128M`),
`MESSENGER_RETRY_DELAY` (`15`).

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

#### Propagation de l'identité du visiteur

Le bloc `location ~ ^/index\.php` transmet explicitement à PHP, en
`fastcgi_param` :

| Paramètre                | Valeur                        | Rôle                                        |
| ------------------------ | ----------------------------- | ------------------------------------------- |
| `HTTP_X_FORWARDED_FOR`   | `$proxy_add_x_forwarded_for`  | chaîne des sauts, observation de nginx en dernier |
| `HTTP_X_FORWARDED_PROTO` | `$forwarded_proto`            | `https` dès que l'amont l'annonce           |
| `HTTP_X_FORWARDED_HOST`  | `$forwarded_host`             | domaine public                              |
| `HTTP_X_FORWARDED_PORT`  | `$forwarded_port`             | port public                                 |
| `HTTP_X_REAL_IP`         | `$remote_addr`                | diagnostic                                  |
| `HTTPS`                  | `$https_flag` `if_not_empty`  | convention CGI                              |

Deux points qui comptent :

- **nginx ne fabrique aucun de ces en-têtes tout seul.** Il retransmet ceux
  reçus du client, et rien de plus. Sans ces lignes, l'application ne dispose
  d'aucune information sur le visiteur dès qu'il y a plus d'un saut ;
- **un en-tête déclaré ici n'est pas retransmis une seconde fois depuis la
  requête cliente** — nginx l'exclut de la retransmission automatique. C'est
  ce qui rend la valeur non contournable : un client qui envoie
  `X-Forwarded-For: 1.2.3.4` produit `1.2.3.4, <son IP réelle>`, et Symfony,
  qui remonte la chaîne de droite à gauche, retient son IP réelle.

`$forwarded_proto` provient d'un `map` : il reprend `X-Forwarded-Proto` quand
l'amont en fournit un, et retombe sur `$scheme` sinon. Derrière Caddy, la
connexion vers nginx est en clair alors que le visiteur est en `https` — sans
ce report, Symfony génère des URLs absolues en `http` (liens de
réinitialisation de mot de passe) et ne pose jamais les cookies `secure`.

Le format de journal `manga_stream_proxy` affiche côte à côte ce que nginx voit
et ce qu'il transmet : `docker compose logs -f nginx`.

### `mailpit`

Serveur SMTP de développement. Il accepte tout, n'expédie rien, et présente les
messages sur **http://localhost:8025**. `MAILER_DSN=smtp://mailpit:1025` est
injectée dans `backend` **et** `worker` — c'est le worker qui expédie
réellement dès que l'envoi passe par Messenger.

L'image est minimale (ni `curl` ni `wget`) : le healthcheck utilise la sonde
intégrée au binaire, `/mailpit readyz`.

En production, le service est rangé dans un profil inactif par
`docker-compose.prod.yml` : il ne démarre pas.

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
docker compose up -d              # toute la stack (8 services)
docker compose up -d database mercure mailpit   # juste l'infra, sans le code applicatif
docker compose ps                 # vérifier les healthchecks
docker compose down               # arrêt, volumes conservés
```

En production, les deux fichiers compose se superposent :

```bash
export COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml
docker compose config | less      # TOUJOURS relire avant de démarrer
docker compose up -d
```

Reconstruire après modification d'un Dockerfile :

```bash
docker compose build --no-cache backend
docker compose up -d --force-recreate backend worker
```

> `backend` et `worker` partagent l'image `manga-stream-backend:dev` : une
> modification du Dockerfile ou de l'entrypoint impose de **recréer les deux**.

Construire et tester l'image frontend de production :

```bash
docker build -f infra/frontend/Dockerfile --target prod \
  --build-context infra=./infra -t manga-stream-frontend:prod ./frontend
docker run --rm -p 8080:80 manga-stream-frontend:prod
```

---

## Production : `caddy/` et `backup/`

Détail complet de la mise en ligne dans la section « Déploiement » du
[README racine](../README.md#déploiement). Ce qui vit ici :

### `caddy/Caddyfile`

Point d'entrée public unique en production. Termine le TLS (Let's Encrypt,
renouvellement automatique) et répartit sur **une seule origine** :

```
/                       -> frontend  (bundle statique)
/api/*                  -> nginx     -> php-fpm -> Symfony
/.well-known/mercure*   -> mercure   (SSE)
```

Trois détails qui font la différence entre « ça marche » et « ça marche
vraiment » :

- **`flush_interval -1`** sur le hub Mercure. Sans lui, Caddy tamponne le flux
  SSE : la connexion `EventSource` s'ouvre normalement, aucune erreur n'est
  levée nulle part, et les évènements arrivent en rafale ou jamais ;
- **`header_up X-Forwarded-For {remote_host}`** écrase la chaîne au lieu de la
  compléter. Par défaut Caddy ajoute son observation à la valeur reçue du
  client ; ici on ne veut conserver aucune valeur d'origine cliente ;
- **HSTS posé par Caddy**, et non dans `nginx/security-headers.conf` où il est
  volontairement commenté. La stack de développement n'a pas de TLS, et un HSTS
  émis en clair est mémorisé des mois par le navigateur, qui refuse ensuite
  tout accès `http` au domaine — `localhost` compris.

Validation hors ligne :

```bash
docker run --rm -e PUBLIC_DOMAIN=exemple.tld -e ACME_EMAIL=a@b.c \
  -v "$PWD/infra/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

> `caddy validate` signale « Unnecessary header_up X-Forwarded-For ». C'est un
> faux positif : Caddy pose bien cet en-tête tout seul, mais en **ajoutant** à
> la valeur reçue, alors qu'on veut l'**écraser**.

### `backup/`

`pg-backup.sh` produit un dump `pg_dump -Fc`, **le relit**
(`pg_restore --list`) et ne le renomme en `.dump` qu'après vérification —
pendant l'écriture il porte l'extension `.partial`. Un dump interrompu par un
disque plein a une taille tout à fait plausible ; sans relecture, on ne
découvre son inutilité que le jour où on en a besoin. Rétention par
`BACKUP_RETENTION_DAYS`.

`pg-restore.sh` a trois modes :

| Commande                        | Effet                                                       |
| ------------------------------- | ----------------------------------------------------------- |
| `pg-restore.sh verify [dump]`   | restaure dans une base **jetable**, compare table par table le nombre de lignes avec la production, supprime la base jetable. **Ne touche pas aux données.** |
| `pg-restore.sh restore <dump>`  | la vraie restauration — **écrase** la base. Exige `I_UNDERSTAND=yes` |
| `pg-restore.sh latest`          | chemin du dump le plus récent                                |

Les deux scripts sont en **`sh` POSIX** et non en bash : `postgres:16-alpine`
n'embarque pas bash. La CI les vérifie avec `sh -n` pour la même raison.

Utilisables sans la surcouche de production, sur la stack de développement :

```bash
docker run --rm --network manga-stream_manga-stream \
  -e PGHOST=database -e PGUSER=manga -e PGPASSWORD=manga -e PGDATABASE=manga_stream \
  -e BACKUP_DIR=/backups \
  -v "$PWD/infra/backup/pg-backup.sh:/usr/local/bin/pg-backup.sh:ro" \
  -v "$PWD/backups:/backups" \
  postgres:16-alpine /usr/local/bin/pg-backup.sh once
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
| Publication Mercure en `401` | JWT signé avec un autre secret que `MERCURE_JWT_SECRET`, ou en-tête `Authorization` absent |
| Le worker répète « transport 'async' is not declared » | Le transport `async` est encore commenté dans `backend/config/packages/messenger.yaml` |
| Le worker répète « not queryable / messenger_messages » | La migration créant `messenger_messages` n'a pas été jouée : `docker compose exec backend php bin/console doctrine:migrations:migrate` |
| Le worker ne voit pas un nouveau message handler | Il exécute le code monté mais garde son cache : `docker compose restart worker` |
| Port déjà utilisé | Surcharger `BACKEND_PORT` / `FRONTEND_PORT` / `MERCURE_PORT` / `POSTGRES_PORT` / `MAILPIT_HTTP_PORT` dans `.env` |
| `Connection refused` sur le port 1025 depuis le backend | Le DSN pointe sur `localhost` au lieu de `mailpit` : dans le conteneur backend, `localhost` c'est le backend |
| Aucun mail dans Mailpit alors que l'API répond OK | L'envoi est routé en asynchrone : c'est le **worker** qui expédie. `docker compose logs -f worker` |
| `getent hosts database` ne répond plus, backend bloqué sur « waiting for database » | Alias DNS perdu par un conteneur redémarré sans être recréé après un changement de config réseau. `docker compose up -d --force-recreate` |
| L'application limite tous les utilisateurs d'un coup | `SYMFONY_TRUSTED_PROXIES` ne couvre pas tous les sauts : l'IP retenue est celle d'un proxy. Voir le journal `manga_stream_proxy` de nginx |
| `Pool overlaps with other one on this address space` | `DOCKER_SUBNET` entre en collision avec un autre réseau Docker : en choisir un autre, et ajuster `NGINX_IP` en conséquence |
| En production, la page s'affiche mais l'application appelle `localhost` | Image frontend construite avec les `VITE_*` de développement : `docker compose build --no-cache frontend` |
| En production, aucune notification n'arrive | `MERCURE_PUBLIC_URL` n'est pas l'URL publique en `https`, ou le hub est servi depuis une autre origine que la page (le `connect-src 'self'` de la CSP la bloque alors) |
