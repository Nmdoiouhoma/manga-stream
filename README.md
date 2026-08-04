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

### En production, les clés vivent dans un volume

En développement, `backend/config/jwt/` est monté depuis le poste : les clés
survivent naturellement. **En production il n'y a aucun bind-mount** — le code
est copié dans l'image — et les clés vivaient donc dans le système de fichiers
du conteneur, c'est-à-dire nulle part de durable.

Le symptôme est particulièrement trompeur : l'inscription fonctionne, le
catalogue fonctionne, et **seule la connexion** échoue en 500
`unable to encode the JWT token` — un message qui ne désigne pas la cause.
Selon les cas, la recréation du conteneur repartait soit d'une paire figée dans
l'image (chiffrée avec la phrase secrète d'une *autre* machine), soit d'une
paire toute neuve à chaque fois (tous les jetons émis invalidés à chaud).

Le volume nommé `jwt_keys` est déclaré dans `docker-compose.prod.yml` pour
`backend`, `worker` et `cron` — les trois doivent partager **la même** paire.
Vérifier qu'elle survit :

```bash
ms exec -T backend sha256sum config/jwt/public.pem
ms up -d --force-recreate backend
ms exec -T backend sha256sum config/jwt/public.pem   # même empreinte
```

Pour **révoquer** les clés (déconnexion générale, comportement attendu d'une
révocation) :

```bash
ms down                                       # jamais `down -v`
sudo docker volume rm manga-stream_jwt_keys
ms up -d
```

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

> **État : EN LIGNE.** <https://16.171.196.127.nip.io> — EC2 `t3.micro`
> (2 vCPU, **908 Mo de RAM utilisables**, 30 Go EBS) à Stockholm, Ubuntu 26.04,
> HTTPS Let's Encrypt via Caddy, 250 animes / 250 mangas / 4392 épisodes en
> base.
>
> La procédure ci-dessous est celle **réellement suivie**, pas une procédure
> théorique. Les écarts avec ce qu'on aurait prévu (agrandir le volume EBS,
> ajouter du swap avant même de construire les images) sont conservés : ce sont
> eux qui coûtent une soirée quand on les découvre en direct.

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

### La machine réellement utilisée, et ce qu'elle impose

| | |
| --- | --- |
| Instance | EC2 `t3.micro`, région `eu-north-1` (Stockholm) |
| CPU / RAM | 2 vCPU / **908 Mo utilisables** |
| Swap | **4 Go** en fichier (`/swapfile`), ajouté à la main |
| Disque | EBS **30 Go** (le volume de 8 Go par défaut ne suffit pas) |
| Système | Ubuntu 26.04 LTS |
| Docker | Engine 29.x + compose v5, dépôt officiel Docker |
| Nom public | `16.171.196.127.nip.io` — nip.io résout `<ip>.nip.io` vers `<ip>`, ce qui donne un nom valide pour Let's Encrypt **sans acheter de domaine** |

**908 Mo, c'est peu, et ça se voit à trois endroits :**

1. **`npm run build` du frontend échoue par manque de mémoire sans swap.** Le
   swap n'est pas un confort ici, c'est un prérequis de construction. À faire
   *avant* le premier `docker compose build`.
2. **Le pool php-fpm est le seul service qui grandit avec le trafic** (~50 Mo
   par requête simultanée). Il est plafonné à 6 enfants, voir
   `infra/backend/php/php-fpm-prod.conf` et le budget mémoire commenté en tête
   de `docker-compose.prod.yml`.
3. **Les images Docker et leurs couches intermédiaires remplissent 8 Go de
   disque** avant même que la stack ne tourne — d'où les 30 Go.

### Prérequis

- ports **80 et 443** ouverts dans le groupe de sécurité. Le 80 n'est pas
  décoratif : il porte le challenge HTTP-01 et la redirection vers HTTPS ;
- un nom qui résout vers l'IP **avant le premier démarrage** — Caddy demande son
  certificat immédiatement et Let's Encrypt plafonne à 5 échecs par heure. Avec
  `nip.io` la résolution est immédiate, il n'y a pas de propagation DNS à
  attendre ;
- une paire de clés SSH. Ici `~/.ssh/aws-manga`.

### Mise en ligne — la procédure réellement suivie

```bash
ssh -i ~/.ssh/aws-manga ubuntu@ec2-16-171-196-127.eu-north-1.compute.amazonaws.com
```

#### 1. Agrandir le volume EBS

À faire **d'abord**, parce que le découvrir au milieu d'un build laisse une
image à moitié construite et un disque plein.

Le volume est porté de 8 à 30 Go dans la console AWS (EC2 → Volumes → *Modify
volume*). AWS agrandit le **disque**, pas la partition ni le système de
fichiers : les deux dernières étapes sont à faire sur la machine, à chaud.

```bash
lsblk                                   # nvme0n1 fait 30G, nvme0n1p1 encore 8G
sudo growpart /dev/nvme0n1 1            # étend la partition
sudo resize2fs /dev/nvme0n1p1           # étend le système de fichiers
df -h /                                 # doit afficher ~29G
```

#### 2. Ajouter 4 Go de swap

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab   # survit au reboot
swapon --show
```

Sans cette étape, le build du frontend meurt sur un `Killed` du tueur OOM —
message qui ne dit pas qu'il manque de la mémoire.

#### 3. Docker, depuis le dépôt officiel

Le paquet `docker.io` d'Ubuntu est trop ancien pour le plugin compose v2
utilisé ici.

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
     -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
     docker-buildx-plugin docker-compose-plugin
sudo docker compose version
```

Les commandes restent préfixées par `sudo` dans toute cette section. Ajouter
l'utilisateur au groupe `docker` équivaut à lui donner root sur la machine —
sur un serveur qui n'a qu'un administrateur, `sudo` explicite est plus lisible
et pas plus coûteux.

#### 4. Cloner le dépôt

```bash
sudo mkdir -p /srv/manga-stream && sudo chown "$USER" /srv/manga-stream
git clone https://github.com/<compte>/manga-stream.git /srv/manga-stream
cd /srv/manga-stream
```

#### 5. `.env.prod` — et les secrets générés ici, jamais ailleurs

Le fichier s'appelle **`.env.prod`** et non `.env` : il est passé
explicitement par `--env-file` (voir plus bas). C'est délibéré — un `.env`
serait ramassé automatiquement par n'importe quelle commande `docker compose`
lancée dans ce répertoire, y compris une commande de développement.

```bash
cp .env.prod.example .env.prod
chmod 600 .env.prod          # il contient tous les secrets de production

openssl rand -hex 32   # -> APP_SECRET
openssl rand -hex 32   # -> MERCURE_JWT_SECRET
openssl rand -hex 32   # -> JWT_PASSPHRASE
openssl rand -hex 24   # -> POSTGRES_PASSWORD (à reporter aussi dans DATABASE_URL)

vi .env.prod
#   PUBLIC_DOMAIN=16.171.196.127.nip.io
#   ACME_EMAIL=<votre adresse>
#   CORS_ALLOW_ORIGIN=^https://16\.171\.196\.127\.nip\.io$      (regex : points échappés)
#   DEFAULT_URI / MERCURE_PUBLIC_URL / VITE_MERCURE_URL sur ce même nom
#   MAILER_DSN=<relais SMTP réel>
```

`.env.prod` est **gitignoré** et ne doit jamais être committé : ce dépôt est
public. Avec un `APP_SECRET` ou une `JWT_PASSPHRASE` connus, n'importe qui
forge un jeton valide pour n'importe quel compte.

#### 6. Construire et démarrer

```bash
cd /srv/manga-stream
sudo docker compose --env-file .env.prod \
  -f docker-compose.yml -f docker-compose.prod.yml config | less   # relire d'abord

sudo docker compose --env-file .env.prod \
  -f docker-compose.yml -f docker-compose.prod.yml build
sudo docker compose --env-file .env.prod \
  -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Le build prend plusieurs minutes sur 2 vCPU. C'est aussi le moment où le swap
sert : sans lui, le frontend meurt en `Killed`.

#### 7. Le schéma, puis les données

Les migrations ne sont **jamais** automatiques (`RUN_MIGRATIONS=0` par défaut) :
un redéploiement ne doit pas modifier un schéma sans qu'on l'ait décidé.

```bash
sudo docker compose --env-file .env.prod \
  -f docker-compose.yml -f docker-compose.prod.yml \
  exec -T backend php bin/console doctrine:migrations:migrate --no-interaction
```

Puis, **au choix** :

```bash
# (a) repartir d'un dump existant — c'est ce qui a été fait ici : le catalogue
#     était déjà constitué en local, le resynchroniser depuis AniList aurait
#     coûté une heure de requêtes pour un résultat identique.
scp -i ~/.ssh/aws-manga backups/manga_stream-<horodatage>.dump \
    ubuntu@ec2-16-171-196-127.eu-north-1.compute.amazonaws.com:/tmp/
sudo cp /tmp/manga_stream-*.dump /srv/manga-stream/backups/
sudo docker compose --env-file .env.prod \
  -f docker-compose.yml -f docker-compose.prod.yml \
  exec -T backup pg-restore.sh restore /backups/manga_stream-<horodatage>.dump

# (b) ou constituer le catalogue depuis AniList (long)
sudo docker compose --env-file .env.prod \
  -f docker-compose.yml -f docker-compose.prod.yml \
  exec -T backend php bin/console app:anilist:sync
```

#### 8. Vérifier

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://16.171.196.127.nip.io/api/animes
# 200 attendu, avec un certificat valide

sudo docker compose --env-file .env.prod \
  -f docker-compose.yml -f docker-compose.prod.yml logs backend | grep entrypoint
# doit contenir « contrat de démarrage vérifié : N routes »
```

### La commande de gestion à distance

Trois `-f`, un `--env-file` et un `sudo` à retaper à chaque fois, c'est la
garantie qu'on finira par en oublier un — et une commande à laquelle il manque
`-f docker-compose.prod.yml` démarre la stack **de développement** sur le
serveur de production, en écrasant le code de l'image par un bind-mount.

Poser l'alias une fois pour toutes dans `~/.bashrc` du serveur :

```bash
cat >> ~/.bashrc <<'EOF'
alias ms='sudo docker compose --env-file /srv/manga-stream/.env.prod \
  -f /srv/manga-stream/docker-compose.yml \
  -f /srv/manga-stream/docker-compose.prod.yml \
  --project-directory /srv/manga-stream'
EOF
. ~/.bashrc
```

Ensuite, depuis n'importe où sur le serveur :

```bash
ms ps                                   # état des conteneurs
ms logs -f backend                      # journal du backend
ms exec -T backend php bin/console cache:pool:list
ms restart backend
ms exec -T backup pg-backup.sh once     # dump immédiat
ms exec cron anilist-sync-status        # dernière synchronisation AniList
```

Et depuis le poste, sans ouvrir de session interactive :

```bash
ssh -i ~/.ssh/aws-manga \
    ubuntu@ec2-16-171-196-127.eu-north-1.compute.amazonaws.com \
    'cd /srv/manga-stream && sudo docker compose --env-file .env.prod \
       -f docker-compose.yml -f docker-compose.prod.yml ps'
```

**`docker compose down -v` ne doit jamais être tapé sur ce serveur** : le `-v`
détruit `database_data`, c'est-à-dire toute la base.

#### Les secrets ne viennent jamais du dépôt

`APP_SECRET`, `MERCURE_JWT_SECRET`, `JWT_PASSPHRASE`, le mot de passe
PostgreSQL et la paire RSA de `backend/config/jwt/` sont **générés sur le
serveur**. Ce dépôt est **public** : reprendre une valeur de `.env.example`
reviendrait à publier la clé. Concrètement, avec un `APP_SECRET` ou une clé JWT
connue, n'importe qui forge un jeton valide pour n'importe quel compte ; avec
`MERCURE_JWT_SECRET`, n'importe qui publie de fausses notifications à tout le
monde.

La paire RSA est générée automatiquement au premier démarrage à partir de
`JWT_PASSPHRASE`, et vit dans le volume `jwt_keys` (voir « En production, les
clés vivent dans un volume »). **Ne la copiez pas depuis un poste de
développement** — c'est précisément ce que faisait le `COPY . .` de l'image
avant l'ajout de `infra/backend/Dockerfile.dockerignore`.

Sauvegardez `.env.prod` **hors du serveur et chiffré**, ainsi qu'une copie de
la paire de clés : perdre `JWT_PASSPHRASE` ou `private.pem` invalide tous les
jetons émis (déconnexion générale), perdre `APP_SECRET` invalide les sessions.

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

Avec l'alias `ms` posé plus haut :

```bash
cd /srv/manga-stream
ms exec -T backup pg-backup.sh once     # d'abord un dump, toujours
git pull
ms build
ms up -d
ms exec -T backend php bin/console doctrine:migrations:migrate --no-interaction
ms ps
ms logs backend | grep entrypoint       # « contrat de démarrage vérifié »
```

Si le domaine ou les URLs publiques ont changé, ajouter
`ms build --no-cache frontend` — sans quoi le bundle garde les anciennes
valeurs (voir le piège `VITE_*` plus haut).

#### Le cache Symfony n'est plus votre problème

Il l'a été, trois fois. Après chaque recréation du conteneur backend,
l'application repartait avec un cache incomplet : `POST /api/register`,
`GET /api/me`, `POST /api/password/forgot`, `POST /api/password/reset` et
`GET /api/mercure/subscription` répondaient **404** — donc du HTML de SPA côté
navigateur — et le filtre `?title=` était ignoré (250 résultats au lieu de 3),
**pendant que le catalogue et les filtres natifs fonctionnaient normalement.**
Une panne partielle, silencieuse, qu'on cherche d'abord côté frontend.

Deux causes, corrigées toutes les deux :

- l'image embarquait le `var/cache/prod` de la machine de build, faute de
  `.dockerignore` (voir `infra/backend/Dockerfile.dockerignore`, qui détaille
  au passage tout ce que le `COPY . .` ramassait au passage — dont les clés
  JWT privées du poste du développeur) ;
- sur un clone git propre, l'image partait avec un cache **vide**, rempli
  paresseusement à la première requête par plusieurs enfants php-fpm en
  concurrence.

Désormais l'entrypoint supprime `var/cache/$APP_ENV` et joue `cache:warmup`
**avant** de lancer php-fpm : un seul processus, à partir du code réellement
présent, avant la première requête. Coût : ~4 s au démarrage du conteneur.

Et un garde-fou refuse le démarrage si les routes critiques manquent :

```
################################################################################
# DÉMARRAGE REFUSÉ — le contrat d'API n'est pas satisfait
#
# routes absentes du routeur : /api/register /api/me ...
```

Un conteneur qui ne démarre pas se voit tout de suite ; une inscription muette,
non. Le contrôle se rejoue hors service sur n'importe quelle image :

```bash
sudo docker run --rm -e APP_ENV=prod manga-stream-backend:prod check
```

Réglages, si le backend fait légitimement évoluer ses routes :
`REQUIRED_ROUTES` (liste de chemins), `REQUIRED_CLASSES`, et la soupape
`STARTUP_CONTRACT_CHECK=0` — à n'utiliser qu'en connaissance de cause. Le
contrôle ne s'applique **qu'en production** (`auto`) : en développement le code
est bind-monté et donc incomplet par nature au fil de la journée, faire refuser
le démarrage pour ça remplacerait un bug de production par une nuisance
quotidienne. La CI joue ce même `check` sur l'image de production à chaque
commit.

### Ce qui reste fragile sur 908 Mo

Le déploiement fonctionne, l'émission du certificat Let's Encrypt, Mercure
derrière du vrai TLS et les cookies `secure` ont été exercés pour de bon. Reste
ce que la taille de la machine impose, et qu'aucune configuration ne fera
disparaître.

| Ce qui cède | Quand | Ce qu'on voit |
| --- | --- | --- |
| **Pool php-fpm** | > 6 requêtes PHP simultanées | Latence, puis 502 quand la file de 64 déborde. Volontaire : une file qui attend vaut mieux qu'une machine en swap. |
| **Build du frontend** | À chaque `build` | ~1 Go de pic sur `npm run build`. Ne passe que grâce au swap. Un `build` pendant que la stack tourne est risqué : **construire, puis basculer**, jamais l'inverse. |
| **Hub Mercure** | Beaucoup d'abonnés SSE simultanés | Chaque connexion SSE est maintenue ouverte. C'est le poste qui grandira ensuite, après php-fpm. |
| **Synchronisation AniList** | Une fois par jour, dans `cron` | Commande CLI à `memory_limit=512M` qui tourne **pendant** que le site sert. C'est le seul moment où deux gros consommateurs coexistent. |
| **Swap sur EBS** | Dès qu'on y touche vraiment | Ce n'est pas de la RAM lente, c'est du réseau. Une machine qui swappe pour de bon n'est pas ralentie, elle est arrêtée. |

Les plafonds `deploy.resources.limits` de `docker-compose.prod.yml` ne créent
pas de mémoire : ils garantissent qu'un service qui dérape est tué **seul**, au
lieu d'emporter PostgreSQL — que le tueur OOM du noyau viserait en premier,
étant le plus gros processus de la machine.

**Le premier euro à dépenser** n'est pas une seconde instance mais **le passage
en `t3.small` (2 Go)**, qui double la marge et permet de remonter
`pm.max_children`. La règle de dimensionnement est
`(RAM disponible pour PHP) / 60 Mo`.

Deux points restent non exercés :

- le **renouvellement** du certificat (il faut attendre 60 jours) ;
- le comportement sous **charge réelle et soutenue** : les chiffres ci-dessus
  viennent de mesures au repos et de calculs, pas d'un tir de charge.

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
