# manga-stream

Plateforme de streaming et de suivi manga / anime : catalogue alimenté par
[AniList](https://anilist.co), suivi de progression par utilisateur et
notifications temps réel via [Mercure](https://mercure.rocks).

---

## Stack

| Couche      | Technologie                                        |
| ----------- | -------------------------------------------------- |
| Backend     | PHP 8.4, Symfony 8.1, API REST, JWT                 |
| Frontend    | React 19, TypeScript, Vite                          |
| Base        | PostgreSQL 16                                       |
| Temps réel  | Mercure (SSE)                                       |
| Asynchrone  | Symfony Messenger (transport Doctrine)              |
| Serveur web | nginx (front controller Symfony + SPA statique)     |
| Infra       | Docker Compose, GitHub Actions                      |

---

## Architecture du dépôt

```
manga-stream/
├── backend/            # API Symfony (PHP 8.4)
├── frontend/           # SPA React + TypeScript (Vite)
├── docs/               # openapi.yaml : contrat partagé back <-> front
├── infra/              # Dockerfiles, config nginx, doc infra
├── .github/workflows/  # CI GitHub Actions
├── docker-compose.yml  # Stack de développement
└── .env.example        # Gabarit d'environnement
```

Chaque dossier est autonome : `backend/` et `frontend/` ne contiennent aucun
fichier Docker, toute l'infrastructure vit dans `infra/`.

---

## Démarrage

Prérequis : Docker + `docker compose` (v2). Rien d'autre n'est nécessaire —
PHP et Node tournent dans les conteneurs.

```bash
cp .env.example .env
docker compose up -d
```

Premier démarrage : les conteneurs installent eux-mêmes `vendor/` et
`node_modules/`, comptez quelques minutes. Suivez la progression avec
`docker compose logs -f`.

### Services accessibles

| URL                                        | Service                          |
| ------------------------------------------ | -------------------------------- |
| http://localhost:5173                      | Frontend (Vite, HMR actif)       |
| http://localhost:8000                      | API backend (nginx → PHP-FPM)    |
| http://localhost:3000/.well-known/mercure  | Hub Mercure (SSE)                |
| http://localhost:3000/.well-known/mercure/ui/ | Debugger Mercure (dev)        |
| `localhost:5432`                           | PostgreSQL (`manga` / `manga`)   |

Un sixième service n'expose aucun port car il ne répond à personne : le
**worker** Messenger, qui traite les tâches de fond (voir plus bas).

```bash
docker compose ps        # les 6 services doivent être "Up"
```

---

## Commandes utiles

```bash
docker compose ps                      # état et santé des services
docker compose logs -f backend         # logs d'un service
docker compose exec backend bash       # shell dans le conteneur PHP
docker compose exec frontend sh        # shell dans le conteneur Node
docker compose down                    # arrêt (les volumes sont conservés)
docker compose down -v                 # arrêt + suppression des données
```

Symfony et Doctrine :

```bash
# Appliquer le schéma (à faire au premier démarrage, puis à chaque migration)
docker compose exec backend php bin/console doctrine:migrations:migrate --no-interaction

docker compose exec backend composer require <package>
```

> Les migrations ne sont **pas** jouées automatiquement : un `docker compose up`
> ne doit jamais modifier un schéma existant sans qu'on l'ait demandé. Pour les
> automatiser malgré tout (CI, environnement jetable), passez `RUN_MIGRATIONS=1`
> dans `.env` et l'entrypoint s'en chargera au démarrage du conteneur.

Frontend :

```bash
docker compose exec frontend npm install <package>
docker compose exec frontend npm run lint
docker compose exec frontend npm run build
```

---

## Authentification JWT : les clés RSA

L'API s'authentifie avec des **JSON Web Tokens** signés par
`lexik/jwt-authentication-bundle`. Le principe, en deux phrases :

- le backend **signe** chaque token avec une **clé privée**
  (`backend/config/jwt/private.pem`) ;
- il **vérifie** ensuite les tokens reçus avec la **clé publique**
  (`backend/config/jwt/public.pem`).

Ces deux fichiers forment une paire RSA de 4096 bits. La clé privée est un
**secret absolu** : quiconque la possède peut fabriquer un token valide pour
n'importe quel compte, y compris un compte administrateur. Ce dépôt étant
**public**, `backend/config/jwt/` est listé dans `.gitignore` et la CI échoue
si un fichier `.pem` venait à être suivi par git.

### Vous n'avez rien à faire

Au premier `docker compose up`, l'entrypoint
[`infra/backend/docker-entrypoint.sh`](infra/backend/docker-entrypoint.sh)
constate l'absence des clés et les génère avec `openssl`. Vous devriez voir
dans `docker compose logs backend` :

```
[entrypoint] JWT keypair missing -> generating an RSA 4096 pair in config/jwt/
[entrypoint] JWT keypair ready (config/jwt/private.pem + public.pem, gitignored)
```

La clé privée est chiffrée par la phrase de passe `JWT_PASSPHRASE` de votre
`.env` : si vous changez cette valeur après coup, les clés existantes
deviennent illisibles et il faut les régénérer.

### Régénérer les clés à la main

Utile après un changement de `JWT_PASSPHRASE`, ou pour repartir de zéro
(tous les tokens déjà émis deviennent alors invalides — les utilisateurs
doivent se reconnecter) :

```bash
# 1. on supprime la paire existante (fichiers locaux, jamais versionnés)
rm -rf backend/config/jwt

# 2. on redémarre le backend : l'entrypoint la régénère
docker compose restart backend
docker compose logs --tail 20 backend
```

Variante avec la commande du bundle, une fois `lexik/jwt-authentication-bundle`
installé — elle fait exactement la même chose :

```bash
docker compose exec backend php bin/console lexik:jwt:generate-keypair --overwrite
```

Ou, sans Symfony, directement à l'openssl (c'est ce que fait l'entrypoint) :

```bash
docker compose exec backend sh -c '
  mkdir -p config/jwt
  openssl genpkey -out config/jwt/private.pem -aes256 \
    -pass env:JWT_PASSPHRASE -algorithm rsa -pkeyopt rsa_keygen_bits:4096
  openssl pkey -in config/jwt/private.pem -passin env:JWT_PASSPHRASE \
    -out config/jwt/public.pem -pubout'
```

Pour vérifier vous-même que rien de sensible ne peut partir sur GitHub :

```bash
git check-ignore -v backend/config/jwt/private.pem .env   # doit répondre
git ls-files | grep -E '\.pem$|^\.env$'                   # doit être vide
```

Enfin, `GENERATE_JWT_KEYS=0` dans `.env` désactive la génération automatique
(utile si vous montez vos propres clés dans le conteneur).

---

## Jobs asynchrones : le worker Messenger

Certaines tâches sont trop lentes pour être faites pendant une requête HTTP :
interroger l'API AniList, recalculer des recommandations, envoyer des
notifications. On les **empile** dans une file, et un processus séparé — le
**worker** — les dépile tranquillement.

```
requête HTTP  ──►  backend  ──►  [ file messenger_messages (PostgreSQL) ]
                                              │
                                              ▼
                                    worker (messenger:consume)
```

La file est stockée dans la table `messenger_messages` de la base principale
(transport `doctrine://default`), ce qui évite d'ajouter un RabbitMQ ou un
Redis pour l'instant.

### Le service `worker`

Il utilise **la même image et le même code** que le backend, mais au lieu de
servir du HTTP il exécute :

```bash
php bin/console messenger:consume async -vv --time-limit=3600 --memory-limit=128M
```

- `async` : le nom du transport à consommer ;
- `-vv` : verbeux, on voit chaque message traité dans les logs ;
- `--time-limit=3600` : le consumer s'arrête **volontairement** au bout d'une
  heure ;
- `--memory-limit=128M` : et aussi s'il dépasse 128 Mo.

Ces arrêts volontaires sont une bonne pratique : un processus PHP qui vit des
jours finit toujours par fuir en mémoire. C'est
`infra/backend/docker-entrypoint.sh` qui relance le consumer après chaque
arrêt, dans une boucle de supervision.

Cette boucle sert aussi de filet de sécurité : tant que le transport `async`
n'est pas déclaré dans `backend/config/packages/messenger.yaml`, ou tant que la
migration créant `messenger_messages` n'a pas été jouée, le worker **attend et
réessaie toutes les 15 secondes** au lieu de mourir. Sans cela Docker
redémarrerait le conteneur en boucle (« crash loop ») en inondant les logs.
Vous verrez alors une ligne de ce genre, répétée sans agressivité :

```
[entrypoint] worker: transport 'async' is not declared yet in config/packages/messenger.yaml -> waiting (retry every 15s)
```

### Le piloter

```bash
docker compose logs -f worker                 # suivre le travail en direct
docker compose restart worker                 # après un changement de code
docker compose up -d --scale worker=3         # 3 workers en parallèle
docker compose exec backend php bin/console messenger:stats          # taille de la file
docker compose exec backend php bin/console messenger:failed:show    # messages en échec
```

Réglages disponibles dans `.env` : `MESSENGER_CONSUME_TRANSPORTS`,
`MESSENGER_TIME_LIMIT`, `MESSENGER_MEMORY_LIMIT`, `MESSENGER_RETRY_DELAY`.

> Le code (dans `backend/`) applique le contrat suivant : un transport nommé
> `async` alimenté par `MESSENGER_TRANSPORT_DSN`, et une migration Doctrine qui
> crée `messenger_messages` (le DSN porte `auto_setup=0`, donc la table ne se
> crée pas toute seule — c'est volontaire, un schéma doit rester explicite).

---

## Synchronisation AniList

Le catalogue est alimenté par l'API GraphQL publique d'AniList,
`https://graphql.anilist.co` (variable `ANILIST_API_URL`, injectée **à la fois**
dans `backend` et dans `worker`).

```bash
# import / mise à jour du catalogue
docker compose exec backend php bin/console app:anilist:sync

# vérifier que la sortie HTTPS fonctionne depuis le worker
docker compose exec worker sh -c 'curl -s -X POST "$ANILIST_API_URL" \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"{ Media(id: 21, type: ANIME) { title { romaji } } }\"}"'
# -> {"data":{"Media":{"title":{"romaji":"ONE PIECE"}}}}
```

Si la commande est dispatchée en message plutôt qu'exécutée directement, c'est
le worker qui appellera AniList : d'où l'importance que la variable soit
présente des deux côtés.

> AniList applique une limite de débit (rate limit). Une synchronisation
> massive doit donc être découpée en messages, ce que permet précisément le
> worker.

---

## Temps réel : la chaîne Mercure

Deux URL, deux points de vue, et c'est la source de confusion n°1 :

| Variable             | Qui l'utilise            | Valeur                                        |
| -------------------- | ------------------------ | --------------------------------------------- |
| `MERCURE_URL`        | le backend (serveur)     | `http://mercure/.well-known/mercure`          |
| `MERCURE_PUBLIC_URL` | le navigateur (client)   | `http://localhost:3000/.well-known/mercure`   |

`mercure` est le nom du service dans le réseau Docker : il n'existe que
**entre conteneurs**. Le navigateur, lui, ne connaît que `localhost:3000`.
Utiliser l'une à la place de l'autre donne soit un `Connection refused`
côté PHP, soit un `ERR_NAME_NOT_RESOLVED` côté navigateur.

Le hub n'accepte de publier qu'avec un JWT signé en HS256 avec
`MERCURE_JWT_SECRET`, et n'autorise les abonnements du navigateur que depuis
les origines listées dans `MERCURE_CORS_ORIGINS` (dont
`http://localhost:5173`, le serveur Vite).

Tester la chaîne complète sans écrire une ligne de code — dans deux terminaux :

```bash
# terminal 1 : on s'abonne comme le ferait le navigateur
curl -N -H 'Origin: http://localhost:5173' \
  'http://localhost:3000/.well-known/mercure?topic=https://manga-stream.test/anime/1'

# terminal 2 : on publie comme le ferait le backend
docker compose exec backend sh -c '
  JWT=$(php -r "
    \$b = fn(\$d) => rtrim(strtr(base64_encode(\$d), \"+/\", \"-_\"), \"=\");
    \$h = \$b(json_encode([\"alg\"=>\"HS256\",\"typ\"=>\"JWT\"]));
    \$p = \$b(json_encode([\"mercure\"=>[\"publish\"=>[\"*\"]]]));
    echo \"\$h.\$p.\" . \$b(hash_hmac(\"sha256\", \"\$h.\$p\", getenv(\"MERCURE_JWT_SECRET\"), true));
  ")
  curl -s -X POST "$MERCURE_URL" -H "Authorization: Bearer $JWT" \
    -d "topic=https://manga-stream.test/anime/1" \
    -d "data={\"hello\":\"monde\"}"'
```

Le terminal 1 doit afficher immédiatement :

```
id: urn:uuid:...
data: {"hello":"monde"}
```

Le debugger web du hub, http://localhost:3000/.well-known/mercure/ui/, permet
de faire la même chose à la souris.

---

## Tests

### Backend (PHPUnit)

```bash
docker compose exec backend php bin/phpunit           # toute la suite
docker compose exec backend php bin/phpunit --filter AnimeTest
```

Les tests tournent dans l'environnement `test` et sur une base **séparée** :
Doctrine ajoute automatiquement le suffixe `_test` au nom de la base (voir le
bloc `when@test` de `backend/config/packages/doctrine.yaml`). Vos données de
développement ne risquent donc rien. Il faut créer cette base une fois :

```bash
docker compose exec backend php bin/console doctrine:database:create --env=test --if-not-exists
docker compose exec backend php bin/console doctrine:migrations:migrate --env=test --no-interaction
```

### Frontend

```bash
docker compose exec frontend npm run test
```

En CI, ces mêmes tests sont **bloquants** : un test rouge fait échouer le
pipeline, donc le merge.

---

## Environnement

Toutes les variables sont documentées dans [`.env.example`](.env.example).
Les points à retenir :

- à l'intérieur de Docker, la base est joignable sur l'hôte **`database`**
  (pas `localhost`) ;
- le backend publie sur Mercure via **`MERCURE_URL`** (réseau interne) et
  annonce **`MERCURE_PUBLIC_URL`** au navigateur ;
- `backend` et `worker` partagent **exactement** le même environnement : il est
  défini une seule fois dans `docker-compose.yml`, via l'ancre YAML
  `x-backend-env`, puis réutilisé par les deux services. Impossible qu'ils
  divergent ;
- seules les variables préfixées `VITE_` sont exposées au bundle frontend, et
  elles sont figées au moment du build.

`.env` n'est **jamais** versionné ; `.env.example` en est le gabarit et ne
contient que des valeurs de développement volontairement évidentes
(`manga` / `manga`, `!ChangeThisMercureHubJWTSecretKey!`…). Rien de tout cela
ne doit survivre à un déploiement réel. Après avoir tiré une nouvelle version
du dépôt, comparez :

```bash
diff <(grep -o '^[A-Z_]*=' .env.example) <(grep -o '^[A-Z_]*=' .env)
```

---

## Contrat d'API

`docs/openapi.yaml` fait foi pour les échanges backend ↔ frontend. Il est
produit par le backend et versionné ; la CI vérifie qu'il reste suivi par git.

---

## Intégration continue

`.github/workflows/ci.yml` s'exécute sur `push` et `pull_request` vers `main`
et `develop` :

1. **backend** — PHP 8.4 + PostgreSQL 16 en service, `composer install`, paire
   JWT éphémère, `lint:container`, création + migration de la base de test,
   puis **PHPUnit pour de vrai** ;
2. **frontend** — Node 24, `npm ci`, `npm run lint`, `npm run build` ;
3. **docker** — `docker compose config`, syntaxe des entrypoints, garde-fou
   « aucun secret suivi par git », build des images, et démarrage réel de
   `database` + `mercure` en smoke test.

Deux règles à connaître :

- **un test qui échoue fait échouer la CI.** L'étape PHPUnit n'a ni `|| true`
  ni `continue-on-error`. Le seul cas encore toléré est « aucune configuration
  `phpunit.xml.dist` écrite » ; si la configuration existe mais que le binaire
  manque, la CI s'arrête avec un message explicite (`composer require --dev
  symfony/test-pack`) ;
- les autres étapes optionnelles (PHPStan, PHP-CS-Fixer, lockfile frontend)
  s'auto-ignorent tant que l'outillage n'est pas en place.

Le job `CI` en fin de pipeline agrège tous les autres : c'est celui à exiger
en *required status check* dans la protection de branche.

---

## Documentation infra

Détail de chaque service, ports, dépannage : [`infra/README.md`](infra/README.md).
