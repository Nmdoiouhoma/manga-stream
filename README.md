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

docker compose exec backend php bin/console lexik:jwt:generate-keypair
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

## Environnement

Toutes les variables sont documentées dans [`.env.example`](.env.example).
Les points à retenir :

- à l'intérieur de Docker, la base est joignable sur l'hôte **`database`**
  (pas `localhost`) ;
- le backend publie sur Mercure via **`MERCURE_URL`** (réseau interne) et
  annonce **`MERCURE_PUBLIC_URL`** au navigateur ;
- seules les variables préfixées `VITE_` sont exposées au bundle frontend, et
  elles sont figées au moment du build.

---

## Contrat d'API

`docs/openapi.yaml` fait foi pour les échanges backend ↔ frontend. Il est
produit par le backend et versionné ; la CI vérifie qu'il reste suivi par git.

---

## Intégration continue

`.github/workflows/ci.yml` s'exécute sur `push` et `pull_request` vers `main`
et `develop` :

1. **backend** — PHP 8.4 + PostgreSQL, `composer install`, `lint:container`,
   migrations, PHPUnit ;
2. **frontend** — Node 24, `npm ci`, `npm run lint`, `npm run build` ;
3. **docker** — `docker compose config`, build des images, et démarrage réel
   de `database` + `mercure` en smoke test.

Les étapes s'auto-ignorent proprement tant que l'outillage correspondant n'est
pas encore en place (pas de tests, pas de lockfile, etc.).

---

## Documentation infra

Détail de chaque service, ports, dépannage : [`infra/README.md`](infra/README.md).
