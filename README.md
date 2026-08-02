# manga-stream

**Tracker et catalogue manga / anime**, dans l'esprit de MyAnimeList : on y
suit ce qu'on regarde et ce qu'on lit, on note, on met en favori, on reçoit des
recommandations — et quand on veut effectivement regarder un épisode, on suit
le lien vers la plateforme officielle qui le diffuse.

**Ce projet ne diffuse aucune vidéo et n'en diffusera pas.** C'est une question
de droits, pas de faisabilité technique : la diffusion appartient aux
détenteurs des licences. Le produit se place volontairement à côté — il tient
la bibliothèque, l'historique et la découverte, puis renvoie vers la source
légale. **1795 épisodes du catalogue portent déjà une URL Crunchyroll.**

> Le dépôt, le dossier et les conteneurs gardent le nom `manga-stream`, hérité
> du cadrage initial. Renommer n'est pas une simple cosmétique : les volumes
> Docker sont préfixés par le nom du projet compose, et un renommage en
> créerait de nouveaux, vides. La base paraîtrait effacée. La décision reste
> ouverte, elle n'est pas prise ici.

### Ce que fait le produit

| Fonction                        | Détail                                                       |
| ------------------------------- | ------------------------------------------------------------ |
| **Catalogue**                   | Animes et mangas importés d'[AniList](https://anilist.co), avec genres, synopsis, jaquettes, popularité |
| **Suivi de progression**        | Épisode ou chapitre en cours, statut (en cours, terminé, abandonné) |
| **Favoris et notes**            | Bibliothèque personnelle, notation                            |
| **Recommandations**             | Suggestions dérivées du catalogue et des affinités            |
| **Notifications temps réel**    | Nouvel épisode, nouveau chapitre — poussés en SSE via [Mercure](https://mercure.rocks), sans rechargement |
| **Commentaires**                | Discussion par œuvre                                          |
| **Liens vers les plateformes**  | Renvoi vers la diffusion officielle (Crunchyroll aujourd'hui) |

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
├── backend/                 # API Symfony (PHP 8.4)
├── frontend/                # SPA React + TypeScript (Vite)
├── docs/                    # openapi.yaml : contrat partagé back <-> front
├── infra/                   # Dockerfiles, nginx, Caddy, sauvegardes
├── .github/workflows/       # CI GitHub Actions
├── docker-compose.yml       # Stack de développement
├── docker-compose.prod.yml  # Surcouche de production (voir « Déploiement »)
├── .env.example             # Gabarit d'environnement de développement
└── .env.prod.example        # Gabarit d'environnement de production
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
| **http://localhost:8025**                  | **Mailpit — les e-mails envoyés par l'application** |
| `localhost:5432`                           | PostgreSQL (`manga` / `manga`)   |

Deux services n'exposent aucun port car ils ne répondent à personne : le
**worker** Messenger, qui traite les tâches de fond, et le **cron**, qui
déclenche la synchronisation AniList quotidienne (voir plus bas).

```bash
docker compose ps        # les 8 services doivent être "Up"
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

## E-mails en développement : Mailpit

La réinitialisation de mot de passe, les notifications par courriel — tout ce
qui part par e-mail est capturé en local par **Mailpit**. Il se comporte comme
un serveur SMTP tout à fait ordinaire, à ceci près qu'il **n'expédie rien** :
les messages s'empilent dans une interface web.

**http://localhost:8025**

Aucun risque d'écrire à un vrai utilisateur en testant un flux, ni de faire
blacklister un domaine avec des rebonds.

| Variable      | Valeur de dev             | À qui elle sert                                  |
| ------------- | ------------------------- | ------------------------------------------------ |
| `MAILER_DSN`  | `smtp://mailpit:1025`     | `backend` **et** `worker`                         |
| `MAILER_FROM` | `no-reply@manga-stream.local` | expéditeur par défaut                         |

> `mailpit` est le **nom du service compose**, pas `localhost`. Depuis le
> conteneur backend, `localhost` désigne le conteneur backend lui-même — c'est
> l'erreur classique, et elle se manifeste par un `Connection refused` sur le
> port 1025.

Les deux services reçoivent la même valeur par construction : elle est définie
une seule fois dans l'ancre YAML `x-backend-env` du `docker-compose.yml`. C'est
important parce que **c'est le worker qui expédie réellement** dès que l'envoi
est routé en asynchrone via Messenger. Un DSN correct côté API et absent côté
worker donnerait une file qui grossit sans qu'aucun mail ne parte.

### Vérifier la chaîne

```bash
# 1. le conteneur backend joint-il le serveur SMTP ?
docker compose exec backend php -r '
  $fp = stream_socket_client("tcp://mailpit:1025", $e, $s, 5);
  echo $fp ? "SMTP joignable : ".rtrim(fgets($fp))."\n" : "ECHEC: $s\n";'

# 2. l'interface web répond-elle depuis la machine ?
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8025/

# 3. lire la boîte en ligne de commande (API REST de Mailpit)
curl -s http://localhost:8025/api/v1/messages | jq '.messages[] | {From:.From.Address, Subject}'

# 4. vider la boîte avant un test
curl -s -X DELETE http://localhost:8025/api/v1/messages
```

En production Mailpit **ne tourne pas** : `docker-compose.prod.yml` le range
dans un profil inactif et `MAILER_DSN` pointe sur un vrai relais.

---

## L'IP du visiteur derrière les proxys

Un limiteur de débit — contre la force brute sur `/api/login`, contre le spam
sur `/api/register` — n'a de sens que s'il compte **par visiteur**. S'il compte
par proxy, tout le monde partage un compteur unique et **le premier attaquant
verrouille la connexion de tous les autres**.

Or l'application ne voit pas spontanément le visiteur :

```
navigateur ──► Caddy (TLS) ──► nginx ──► php-fpm ──► Symfony
                            ▲
                REMOTE_ADDR s'arrête ici : php-fpm voit
                l'adresse du saut précédent, pas celle du visiteur
```

En développement il n'y a qu'un saut, et `REMOTE_ADDR` se trouve être le
visiteur. **En production il y en a deux**, et `REMOTE_ADDR` vaut l'adresse du
conteneur Caddy — la même pour tout le monde. C'est exactement le scénario du
compteur unique.

La solution tient en deux moitiés, une de chaque côté :

**Côté infra** (fait) — `infra/nginx/default.conf` transmet explicitement à
PHP, en `fastcgi_param` : `X-Forwarded-For` (construit avec
`$proxy_add_x_forwarded_for`), `X-Forwarded-Proto`, `-Host`, `-Port`,
`X-Real-IP` et `HTTPS`. nginx ne les fabrique pas tout seul : sans ces lignes,
il retransmet ce que le client a envoyé, et rien de plus.

**Côté application** — Symfony doit savoir à quels sauts il peut se fier. Rien
à écrire dans `framework.yaml` : la valeur par défaut de
`framework.trusted_proxies` est `%env(default::SYMFONY_TRUSTED_PROXIES)%`, donc
**la variable d'environnement suffit**.

| Environnement | `SYMFONY_TRUSTED_PROXIES` | Pourquoi                                                     |
| ------------- | ------------------------- | ------------------------------------------------------------ |
| Développement | `172.21.0.250`            | l'IP **fixe** de nginx, et elle seule                        |
| Production    | `172.21.0.0/16`           | deux sauts internes (Caddy + nginx), l'adresse de Caddy est allouée dynamiquement |

Pourquoi une IP fixe pour nginx : une adresse allouée dynamiquement change à
chaque recréation du conteneur, et la liste des proxys de confiance devient
fausse **en silence**. Le réseau compose a donc un sous-réseau figé
(`DOCKER_SUBNET=172.21.0.0/16`) et nginx une adresse réservée
(`NGINX_IP=172.21.0.250`).

Pourquoi pas la plage entière en développement : sur Linux, les requêtes venues
de votre poste arrivent avec l'adresse de la passerelle Docker (`172.21.0.1`),
qui appartient à cette plage. La déclarer de confiance permettrait à n'importe
qui, depuis la machine, de se faire passer pour l'IP de son choix.

### Le vérifier

L'usurpation doit rester sans effet : l'observation de nginx est toujours
ajoutée **en dernier** dans `X-Forwarded-For`, et Symfony remonte la chaîne de
droite à gauche jusqu'à la première adresse non-fiable.

```bash
# Le journal nginx montre les deux faces : ce que nginx voit, ce qu'il transmet
docker compose logs -f nginx

# En envoyant un en-tête forgé, la valeur transmise reste "6.6.6.6, <votre IP>"
curl -s -H 'X-Forwarded-For: 6.6.6.6' http://localhost:8000/api > /dev/null
```

Le format de journal `manga_stream_proxy` affiche `$remote_addr`, la valeur
reçue et la valeur transmise. Si l'application se met un jour à limiter tout le
monde d'un coup, c'est la première chose à regarder.

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
- `MAILER_DSN` est injectée dans `backend` **et** `worker` : c'est le worker
  qui expédie réellement les mails routés en asynchrone ;
- `SYMFONY_TRUSTED_PROXIES` est lue d'office par Symfony et conditionne
  l'identification du visiteur derrière les proxys (voir plus haut) ;
- seules les variables préfixées `VITE_` sont exposées au bundle frontend, et
  elles sont **figées au moment du build** — les modifier sans reconstruire
  l'image ne produit aucun effet.

`.env` n'est **jamais** versionné ; `.env.example` en est le gabarit et ne
contient que des valeurs de développement volontairement évidentes
(`manga` / `manga`, `!ChangeThisMercureHubJWTSecretKey!`…). Rien de tout cela
ne doit survivre à un déploiement réel. Après avoir tiré une nouvelle version
du dépôt, comparez :

```bash
diff <(grep -o '^[A-Z_]*=' .env.example) <(grep -o '^[A-Z_]*=' .env)
```

---

## Déploiement

> **État** : tout est écrit, validé et testable hors ligne — surcouche compose,
> configuration Caddy, scripts de sauvegarde et de restauration. **Rien n'est
> encore déployé** : il n'y a ni serveur ni domaine à ce jour. La section
> décrit la mise en ligne pas à pas et signale ce qui ne pourra être vérifié
> que sur la machine cible.

### Pourquoi un VPS et pas un PaaS

La stack compte **huit services** liés par un réseau privé, deux volumes de
données à conserver, un hub SSE et un worker au long cours — le tout déjà
entièrement décrit en Docker Compose. Sur un PaaS il faudrait éclater cette
description en autant de composants facturés séparément, gérer la persistance
ailleurs, et réécrire le routage. Un VPS exécute le fichier tel quel.

Le coût de ce choix est réel et assumé : mises à jour système, pare-feu,
supervision et sauvegardes sont à votre charge. La suite les couvre.

### La topologie visée

```
Internet
   │  443/tcp + 80/tcp   (seuls ports publics)
   ▼
┌──────────────────────────────────────────────────────────┐
│ Caddy — TLS Let's Encrypt, renouvellement automatique     │
│   /                     → frontend  (bundle statique)     │
│   /api/*                → nginx → php-fpm → Symfony       │
│   /.well-known/mercure  → hub Mercure (SSE)               │
└──────────────────────────────────────────────────────────┘
   │ réseau Docker privé — rien d'autre n'est publié
   ▼
 database · backend · worker · cron · nginx · frontend · mercure · backup
```

**Une seule origine publique** pour tout le produit. Ce n'est pas un détail
esthétique :

- plus aucun CORS côté navigateur ;
- le `connect-src 'self'` de `infra/nginx/security-headers.conf` reste valable.
  Un hub sur un sous-domaine séparé le ferait échouer **sans erreur visible** :
  la page s'afficherait, et aucune notification n'arriverait jamais ;
- les cookies n'ont pas besoin d'être partagés entre sites.

### Prérequis sur le serveur

- Debian 12 ou Ubuntu 24.04, 2 vCPU / 4 Go, Docker Engine + plugin compose ;
- un enregistrement DNS **A** (et **AAAA** en IPv6) pointant sur le serveur,
  **propagé avant le premier démarrage** — Caddy demande son certificat
  immédiatement et Let's Encrypt plafonne à 5 échecs par heure ;
- ports 80 et 443 ouverts. Le 80 n'est pas décoratif : il porte le challenge
  HTTP-01 et la redirection vers HTTPS.

### Mise en ligne

```bash
# 1. le code
ssh admin@vps
sudo mkdir -p /srv/manga-stream && sudo chown "$USER" /srv/manga-stream
git clone https://github.com/<compte>/manga-stream.git /srv/manga-stream
cd /srv/manga-stream

# 2. l'environnement
cp .env.prod.example .env
chmod 600 .env

# 3. LES SECRETS SE GÉNÈRENT ICI, PAS AILLEURS
openssl rand -hex 32   # -> APP_SECRET
openssl rand -hex 32   # -> MERCURE_JWT_SECRET
openssl rand -hex 32   # -> JWT_PASSPHRASE
openssl rand -hex 24   # -> POSTGRES_PASSWORD (à reporter aussi dans DATABASE_URL)
vi .env                # + PUBLIC_DOMAIN, ACME_EMAIL, MAILER_DSN, CORS_ALLOW_ORIGIN

# 4. deux fichiers compose à chaque commande — on le pose une fois pour toutes
export COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml

# 5. relire ce que compose a réellement compris AVANT de démarrer
docker compose config | less

# 6. construire puis démarrer
docker compose build
docker compose up -d

# 7. le schéma (jamais automatique)
docker compose exec backend php bin/console doctrine:migrations:migrate --no-interaction

# 8. le catalogue
docker compose exec backend php bin/console app:anilist:sync
```

#### Les secrets ne viennent jamais du dépôt

`APP_SECRET`, `MERCURE_JWT_SECRET`, `JWT_PASSPHRASE`, le mot de passe
PostgreSQL et la paire RSA de `backend/config/jwt/` sont **générés sur le
serveur**. Ce dépôt est **public** : reprendre une valeur de `.env.example`
reviendrait à publier la clé. Concrètement, avec un `APP_SECRET` ou une clé JWT
connue, n'importe qui forge un jeton valide pour n'importe quel compte ; avec
`MERCURE_JWT_SECRET`, n'importe qui publie de fausses notifications à tout le
monde.

La paire RSA est générée automatiquement au premier démarrage à partir de
`JWT_PASSPHRASE`. **Ne la copiez pas depuis un poste de développement.**

Sauvegardez `.env` et `backend/config/jwt/` **hors du serveur et chiffrés** :
perdre `JWT_PASSPHRASE` ou `private.pem` invalide tous les jetons émis
(déconnexion générale), perdre `APP_SECRET` invalide les sessions.

#### Le piège des variables `VITE_*`

**C'est l'erreur la plus coûteuse de ce déploiement, parce qu'elle ne produit
aucun message d'erreur.**

Vite ne lit pas `VITE_API_URL` à l'exécution : il **remplace textuellement**
les `import.meta.env.VITE_*` par leur valeur pendant `npm run build`. Après
quoi ces variables n'existent plus — elles sont écrites en dur dans le
JavaScript téléchargé par le visiteur.

Une image construite avec les valeurs de développement démarre normalement,
nginx répond 200, la page s'affiche… et **le navigateur du visiteur appelle sa
propre machine** sur `http://localhost:8000`. Rien dans les logs du serveur.
On cherche le problème côté backend pendant une heure.

D'où les `args` de build dans `docker-compose.prod.yml`, et cette conséquence :
**tout changement de domaine impose une reconstruction.**

```bash
docker compose build --no-cache frontend && docker compose up -d frontend

# vérification : le domaine doit apparaître, jamais "localhost"
docker compose exec frontend sh -c \
  'grep -ro "localhost:[0-9]*" /usr/share/nginx/html/assets | head'
# une sortie vide est le résultat attendu
```

La CI refuse désormais toute URL `localhost` dans les arguments de build de la
surcouche de production — mais elle ne peut rien contre une image construite à
la main avec le mauvais `.env`.

#### Les autres valeurs qui changent entre dev et prod

| Variable                  | Développement                        | Production                              |
| ------------------------- | ------------------------------------ | --------------------------------------- |
| `MERCURE_PUBLIC_URL`      | `http://localhost:3000/...`          | `https://<domaine>/.well-known/mercure` |
| `MERCURE_URL`             | `http://mercure/.well-known/mercure` | **inchangée** — interne, conteneur à conteneur |
| `CORS_ALLOW_ORIGIN`       | tout `localhost`                     | `^https://(www\.)?<domaine>$`           |
| `SYMFONY_TRUSTED_PROXIES` | `172.21.0.250`                       | `172.21.0.0/16`                         |
| `BIND_IP`                 | `0.0.0.0`                            | `127.0.0.1`                             |
| `MAILER_DSN`              | `smtp://mailpit:1025`                | relais réel                             |
| `MERCURE_ALLOW_ANONYMOUS` | `false`                              | `false` — non négociable                |

`MERCURE_PUBLIC_URL` mérite une phrase à part : c'est l'URL que le
**navigateur** ouvrira, elle doit être en `https` sur le domaine public. Y
laisser une valeur interne donne un symptôme trompeur — les publications côté
serveur partent bien, et aucune notification n'arrive jamais.

### Sauvegarde, et surtout restauration

Un backup jamais restauré n'est pas un backup : c'est un fichier dont on
suppose qu'il contient quelque chose.

Le service `backup` de la surcouche de production tourne en boucle et produit
un dump par jour (`BACKUP_INTERVAL`), conservé 14 jours
(`BACKUP_RETENTION_DAYS`), dans un répertoire **de l'hôte** — pour qu'il soit
directement copiable hors-site sans passer par `docker cp`.

`infra/backup/pg-backup.sh` **relit chaque dump** (`pg_restore --list`) et ne
le renomme en `.dump` qu'après vérification. Tant que l'écriture est en cours,
le fichier porte l'extension `.partial` : un dump interrompu par un disque
plein a une taille tout à fait plausible, et sans cette relecture on ne
découvre son inutilité que le jour où on en a besoin.

```bash
docker compose exec backup pg-backup.sh once      # dump immédiat
docker compose exec backup pg-restore.sh latest   # chemin du dernier dump
```

**L'essai de restauration** — à passer régulièrement, il ne touche pas à la
production : il restaure dans une base jetable, compare table par table le
nombre de lignes, puis supprime la base jetable.

```bash
docker compose exec backup pg-restore.sh verify
```

Sortie obtenue sur la base de développement (résultat réel) :

```
[restore] dump examine        : /backups/manga_stream-20260802-174229.dump (308.0K)
[restore] restauration dans manga_stream_restore_check...

TABLE                                PRODUCTION    RESTAUREE
---------------------------------- ------------ ------------
anime                                       100          100
chapter                                   13536        13536
episode                                    4392         4392
user                                         33           33
...
[restore] tables : 15 en production, 15 dans la restauration
[restore] RESULTAT : IDENTIQUE — la sauvegarde est restaurable.
```

**La vraie restauration**, elle, écrase la base — d'où le garde-fou :

```bash
I_UNDERSTAND=yes docker compose exec -e I_UNDERSTAND=yes backup \
  pg-restore.sh restore /backups/manga_stream-AAAAMMJJ-HHMMSS.dump

docker compose restart backend worker cron
```

Deux choses restent **à votre charge** :

1. **sortir les dumps de la machine.** Un backup posé sur le disque du serveur
   qu'il est censé sauver ne protège que des erreurs logiques, pas de la perte
   du serveur. `rsync`, `restic` ou `rclone` vers un stockage distinct ;
2. **planifier l'essai de restauration.** Une ligne de cron système suffit :

   ```cron
   0 4 * * 1 cd /srv/manga-stream && COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml docker compose exec -T backup pg-restore.sh verify
   ```

### Le volume PostgreSQL

`database_data` porte **toute la base**. Il survit à `docker compose down`,
à `up -d --force-recreate` et à une reconstruction d'image.

Deux façons de le perdre, toutes deux évitables :

- **`docker compose down -v`** — le `-v` détruit les volumes. À ne jamais taper
  sur ce serveur ;
- **renommer le projet, un service ou un volume.** Les volumes sont préfixés
  par le nom du projet compose (`manga-stream_database_data`). Renommer en
  crée de nouveaux, vides : la base semble effacée alors que les données sont
  toujours là, sous l'ancien nom. C'est la raison pour laquelle
  `docker-compose.prod.yml` ne renomme **rien**.

### Mettre à jour

```bash
cd /srv/manga-stream
docker compose exec backup pg-backup.sh once      # d'abord un dump
git pull
docker compose build
docker compose up -d
docker compose exec backend php bin/console doctrine:migrations:migrate --no-interaction
docker compose ps
```

Si le domaine ou les URLs publiques ont changé, ajouter
`docker compose build --no-cache frontend` — sans quoi le bundle garde les
anciennes valeurs (voir le piège `VITE_*` plus haut).

### Ce qui ne pourra être vérifié que le jour J

Tout ce qui suit dépend d'une machine et d'un nom de domaine réels, et n'a donc
**pas** pu être exercé :

- l'émission du certificat Let's Encrypt et son renouvellement (utiliser
  `acme_ca` en bac à sable, commenté en tête du `Caddyfile`, pour le premier
  essai) ;
- le comportement de **Mercure derrière du vrai TLS** : le flux SSE traverse un
  saut de plus, et `flush_interval -1` est ce qui l'empêche d'être tamponné ;
- les **cookies `secure`** — ils ne sont posés que sur une connexion réellement
  chiffrée, donc invérifiables en local ;
- la valeur de `SYMFONY_TRUSTED_PROXIES` **sur le sous-réseau réel du serveur**
  si `DOCKER_SUBNET` a dû être changé pour cause de collision ;
- le débit et la mémoire sous charge réelle.

Ce qui **a** été vérifié hors ligne : validité de la surcouche compose et du
`Caddyfile`, absence de Mailpit en production, absence d'URL `localhost` dans
le build frontend, propagation de l'IP client à travers un vrai Caddy placé
devant nginx, et le cycle complet sauvegarde → restauration → comparaison des
données.

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
3. **docker** — `docker compose config`, syntaxe des entrypoints et des scripts
   de sauvegarde, garde-fou « aucun secret suivi par git », build des images,
   et démarrage réel de `database` + `mercure` en smoke test ;
4. **la surcouche de production** — `docker-compose.prod.yml` est validé avec
   `.env.prod.example`, le `Caddyfile` avec `caddy validate`. La CI refuse un
   Mailpit actif en production et toute URL `localhost` dans les arguments de
   build du frontend. Une surcouche jamais validée dérive en silence et ne se
   révèle fausse que le jour de la mise en ligne.

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
