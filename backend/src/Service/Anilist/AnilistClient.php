<?php

declare(strict_types=1);

namespace App\Service\Anilist;

use Psr\Log\LoggerInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Contracts\HttpClient\Exception\ExceptionInterface as HttpExceptionInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;

/**
 * Client GraphQL de l'API publique AniList.
 *
 * Politique de débit — AniList annonce 90 requêtes/minute mais applique en pratique
 * une limite plus basse et bannit temporairement les clients trop insistants. Trois
 * garde-fous sont donc implémentés :
 *
 *  1. un intervalle minimal entre deux requêtes (par défaut 1,2 s, soit ~50 req/min) ;
 *  2. la lecture de `X-RateLimit-Remaining` : sous le seuil bas, on attend jusqu'au
 *     `X-RateLimit-Reset` annoncé avant de repartir ;
 *  3. la gestion du `429` avec respect du `Retry-After`, et un backoff exponentiel
 *     sur les erreurs serveur / réseau.
 */
class AnilistClient
{
    public const ENDPOINT = 'https://graphql.anilist.co';

    /**
     * Requête paginée. `episodes`, `chapters` et `volumes` sont demandés dans les deux
     * cas : AniList renvoie simplement `null` pour ceux qui ne s'appliquent pas.
     */
    private const PAGE_QUERY = <<<'GRAPHQL'
        query ($page: Int!, $perPage: Int!, $type: MediaType!) {
          Page(page: $page, perPage: $perPage) {
            pageInfo { currentPage hasNextPage total }
            media(type: $type, sort: POPULARITY_DESC, isAdult: false) {
              id
              type
              title { romaji english native }
              description(asHtml: false)
              coverImage { extraLarge large medium }
              bannerImage
              episodes
              chapters
              volumes
              duration
              averageScore
              popularity
              status
              season
              seasonYear
              startDate { year month day }
              endDate { year month day }
              genres
            }
          }
        }
        GRAPHQL;

    /**
     * Détail « épisodes » pour un lot de médias déjà connus, interrogés par identifiant.
     *
     * Ce que AniList expose réellement, et ses limites — vérifié sur l'API publique :
     *
     *  - `streamingEpisodes` : titre, vignette et URL de streaming, SANS champ de
     *    numérotation. Le numéro n'existe que dans le libellé (« Episode 12 - ... »),
     *    et la liste mélange régulièrement plusieurs saisons : l'entrée « Boku no Hero
     *    Academia » (id 21459) déclare 13 épisodes mais expose des libellés allant
     *    jusqu'à « Episode 159 », qui appartiennent aux saisons suivantes ;
     *  - `airingSchedule` : là, le numéro d'épisode est explicite et fiable, mais il
     *    n'y a ni titre ni vignette, et la liste n'existe que pour les séries dont la
     *    diffusion TV est référencée (rien pour Naruto, Death Note ou Steins;Gate).
     *
     * Les deux sources sont donc complémentaires et aucune n'est complète : la fusion,
     * le rejet des numéros hors bornes et la complétion par numérotation dérivée sont
     * faits ici même, dans {@see parseEpisodes()}, qui est une fonction pure.
     *
     * Rien d'équivalent n'existe côté manga : l'introspection du type `Media` d'AniList
     * ne comporte aucun champ listant les chapitres — `chapters` est un simple entier.
     * Les chapitres ne peuvent donc pas être importés, seulement dérivés de ce compte.
     */
    private const EPISODE_QUERY = <<<'GRAPHQL'
        query ($ids: [Int], $perPage: Int!, $schedulePerPage: Int!) {
          Page(page: 1, perPage: $perPage) {
            media(id_in: $ids, type: ANIME) {
              id
              episodes
              duration
              streamingEpisodes { title thumbnail url site }
              airingSchedule(perPage: $schedulePerPage) { nodes { episode airingAt } }
            }
          }
        }
        GRAPHQL;

    /** Taille maximale d'un lot d'identifiants pour {@see EPISODE_QUERY}. */
    public const EPISODE_BATCH_SIZE = 25;

    /** Nombre de dates de diffusion demandées par média (plafond AniList : 50). */
    private const SCHEDULE_PER_PAGE = 50;

    /**
     * Garde-fou : au-delà, on considère la réponse aberrante et on cesse de dériver des
     * numéros. Sans plafond, une valeur fantaisiste dans `episodes` suffirait à créer
     * des centaines de milliers de lignes.
     */
    public const MAX_EPISODES_PER_MEDIA = 2000;

    /**
     * Libellés de `streamingEpisodes`. Le numéro est le seul élément exploitable de
     * façon fiable ; le reste du libellé est conservé tel quel comme titre lorsqu'il
     * existe, et laissé à `null` sinon — on n'invente pas de titre.
     */
    private const STREAMING_LABEL_PATTERN = '/^\s*(?:episode|épisode|ep)\.?\s*(\d{1,5})\s*(?:[-–—:.]\s*(.*))?$/iu';

    /** Seuil de requêtes restantes en dessous duquel on attend la fenêtre suivante. */
    private const REMAINING_THRESHOLD = 5;

    /** Plafond d'attente, pour ne jamais bloquer un worker indéfiniment. */
    private const MAX_WAIT_SECONDS = 90.0;

    private float $lastRequestAt = 0.0;

    public function __construct(
        private readonly HttpClientInterface $httpClient,
        private readonly LoggerInterface $logger,
        #[Autowire(param: 'app.anilist.endpoint')]
        private readonly string $endpoint = self::ENDPOINT,
        #[Autowire(param: 'app.anilist.min_interval')]
        private readonly float $minIntervalSeconds = 1.2,
        #[Autowire(param: 'app.anilist.max_retries')]
        private readonly int $maxRetries = 4,
    ) {
    }

    /**
     * Récupère une page de médias populaires.
     *
     * @param string $type    AnilistMedia::TYPE_ANIME ou AnilistMedia::TYPE_MANGA
     * @param int    $page    1-indexé
     * @param int    $perPage 1..50 (plafond imposé par AniList)
     *
     * @throws AnilistException
     */
    public function fetchPage(string $type, int $page, int $perPage = 50): AnilistPage
    {
        $payload = $this->request(self::PAGE_QUERY, [
            'page' => max(1, $page),
            'perPage' => max(1, min(50, $perPage)),
            'type' => AnilistMedia::TYPE_MANGA === $type ? AnilistMedia::TYPE_MANGA : AnilistMedia::TYPE_ANIME,
        ]);

        return self::parsePage($payload, $page);
    }

    /**
     * Parsing pur d'une réponse `Page` : aucune I/O, directement testable.
     *
     * @param array<string, mixed> $payload corps JSON décodé de la réponse GraphQL
     */
    public static function parsePage(array $payload, int $requestedPage = 1): AnilistPage
    {
        $page = $payload['data']['Page'] ?? null;
        if (!\is_array($page)) {
            throw new AnilistException('Réponse AniList inattendue : nœud `data.Page` absent.');
        }

        $info = \is_array($page['pageInfo'] ?? null) ? $page['pageInfo'] : [];
        $nodes = \is_array($page['media'] ?? null) ? $page['media'] : [];

        $media = [];
        foreach ($nodes as $node) {
            if (!\is_array($node)) {
                continue;
            }

            try {
                $media[] = AnilistMedia::fromApiNode($node);
            } catch (\InvalidArgumentException) {
                // Un média inexploitable ne doit pas faire échouer la page entière.
                continue;
            }
        }

        return new AnilistPage(
            media: $media,
            currentPage: is_numeric($info['currentPage'] ?? null) ? (int) $info['currentPage'] : $requestedPage,
            hasNextPage: (bool) ($info['hasNextPage'] ?? false),
            total: is_numeric($info['total'] ?? null) ? (int) $info['total'] : null,
        );
    }

    /**
     * Récupère le détail des épisodes pour un lot de médias déjà connus.
     *
     * @param list<int> $anilistIds au plus {@see EPISODE_BATCH_SIZE} identifiants
     *
     * @return array<int, list<AnilistEpisode>> indexé par identifiant AniList ; un média
     *                                          sans aucune donnée exploitable est absent
     *
     * @throws AnilistException
     */
    public function fetchEpisodes(array $anilistIds): array
    {
        $ids = array_values(array_unique(array_filter($anilistIds, static fn (int $id): bool => $id > 0)));

        if ([] === $ids) {
            return [];
        }

        $payload = $this->request(self::EPISODE_QUERY, [
            'ids' => $ids,
            'perPage' => min(self::EPISODE_BATCH_SIZE, \count($ids)),
            'schedulePerPage' => self::SCHEDULE_PER_PAGE,
        ]);

        return self::parseEpisodes($payload);
    }

    /**
     * Fusion des deux sources d'AniList. Aucune I/O : directement testable.
     *
     * @param array<string, mixed> $payload corps JSON décodé de la réponse GraphQL
     *
     * @return array<int, list<AnilistEpisode>>
     */
    public static function parseEpisodes(array $payload): array
    {
        $page = $payload['data']['Page'] ?? null;
        if (!\is_array($page)) {
            throw new AnilistException('Réponse AniList inattendue : nœud `data.Page` absent.');
        }

        $nodes = \is_array($page['media'] ?? null) ? $page['media'] : [];

        $result = [];
        foreach ($nodes as $node) {
            if (!\is_array($node) || !is_numeric($node['id'] ?? null)) {
                continue;
            }

            $episodes = self::mergeEpisodeSources($node);
            if ([] !== $episodes) {
                $result[(int) $node['id']] = $episodes;
            }
        }

        return $result;
    }

    /**
     * @param array<string, mixed> $node
     *
     * @return list<AnilistEpisode> trié par numéro croissant
     */
    private static function mergeEpisodeSources(array $node): array
    {
        $declared = AnilistMedia::positiveInt($node['episodes'] ?? null);
        $duration = AnilistMedia::positiveInt($node['duration'] ?? null);

        /** @var array<int, array{title: ?string, thumbnail: ?string, streamUrl: ?string, airDate: ?\DateTimeImmutable, source: string}> $merged */
        $merged = [];

        // 1) `airingSchedule` : le numéro y est explicite, donc digne de confiance.
        $schedule = $node['airingSchedule']['nodes'] ?? null;
        foreach (\is_array($schedule) ? $schedule : [] as $entry) {
            if (!\is_array($entry)) {
                continue;
            }

            $number = AnilistMedia::positiveInt($entry['episode'] ?? null);
            if (null === $number || !self::isPlausibleNumber($number, $declared)) {
                continue;
            }

            $merged[$number] ??= self::emptySlot();
            $merged[$number]['source'] = AnilistEpisode::SOURCE_SCHEDULE;

            if (is_numeric($entry['airingAt'] ?? null)) {
                $merged[$number]['airDate'] = (new \DateTimeImmutable('@'.(int) $entry['airingAt']))
                    ->setTimezone(new \DateTimeZone('UTC'));
            }
        }

        // 2) `streamingEpisodes` : titre/vignette/URL, mais numéro à extraire du libellé.
        $streaming = $node['streamingEpisodes'] ?? null;
        foreach (\is_array($streaming) ? $streaming : [] as $entry) {
            if (!\is_array($entry)) {
                continue;
            }

            [$number, $title] = self::parseStreamingLabel($entry['title'] ?? null);

            // Un libellé sans numéro exploitable est écarté : le rattacher « au suivant »
            // reviendrait à attribuer un vrai titre à un mauvais épisode.
            if (null === $number || !self::isPlausibleNumber($number, $declared)) {
                continue;
            }

            $slot = $merged[$number] ?? self::emptySlot();
            $slot['title'] ??= $title;
            $slot['thumbnail'] ??= self::url($entry['thumbnail'] ?? null);
            $slot['streamUrl'] ??= self::url($entry['url'] ?? null);
            $slot['source'] = AnilistEpisode::SOURCE_STREAMING;

            $merged[$number] = $slot;
        }

        // 3) Complétion : on comble les trous par une simple numérotation, sans jamais
        // inventer de titre. La borne vient d'`episodes` quand AniList le renseigne,
        // sinon du plus grand numéro réellement observé (séries en cours, où
        // `episodes` vaut `null` : One Piece par exemple).
        $fillTo = $declared ?? (([] === $merged) ? 0 : max(array_keys($merged)));
        $fillTo = min($fillTo, self::MAX_EPISODES_PER_MEDIA);

        for ($number = 1; $number <= $fillTo; ++$number) {
            $merged[$number] ??= self::emptySlot();
        }

        ksort($merged);

        $episodes = [];
        foreach ($merged as $number => $slot) {
            $episodes[] = new AnilistEpisode(
                number: $number,
                title: $slot['title'],
                thumbnail: $slot['thumbnail'],
                streamUrl: $slot['streamUrl'],
                airDate: $slot['airDate'],
                duration: $duration,
                source: $slot['source'],
            );
        }

        return $episodes;
    }

    /**
     * Extrait le numéro et le titre résiduel d'un libellé `streamingEpisodes`.
     *
     * @return array{0: ?int, 1: ?string}
     */
    public static function parseStreamingLabel(mixed $label): array
    {
        if (!\is_string($label) || '' === trim($label)) {
            return [null, null];
        }

        if (1 !== preg_match(self::STREAMING_LABEL_PATTERN, $label, $matches)) {
            return [null, null];
        }

        $number = (int) $matches[1];
        $title = trim($matches[2] ?? '');

        return [$number > 0 ? $number : null, '' === $title ? null : $title];
    }

    /**
     * Un numéro n'est retenu que s'il tient dans le nombre d'épisodes annoncé.
     *
     * C'est ce filtre qui évite d'attribuer à une entrée « saison 1 » les épisodes des
     * saisons suivantes, que `streamingEpisodes` mélange allègrement. Quand AniList ne
     * déclare aucun total (série en cours), on ne peut rien vérifier : on accepte.
     */
    private static function isPlausibleNumber(int $number, ?int $declared): bool
    {
        if ($number < 1 || $number > self::MAX_EPISODES_PER_MEDIA) {
            return false;
        }

        return null === $declared || $number <= $declared;
    }

    /**
     * @return array{title: ?string, thumbnail: ?string, streamUrl: ?string, airDate: ?\DateTimeImmutable, source: string}
     */
    private static function emptySlot(): array
    {
        return [
            'title' => null,
            'thumbnail' => null,
            'streamUrl' => null,
            'airDate' => null,
            'source' => AnilistEpisode::SOURCE_DERIVED,
        ];
    }

    private static function url(mixed $value): ?string
    {
        if (!\is_string($value)) {
            return null;
        }

        $value = trim($value);

        return '' !== $value && false !== filter_var($value, \FILTER_VALIDATE_URL) ? $value : null;
    }

    /**
     * Exécute une requête GraphQL en appliquant la politique de débit et de retry.
     *
     * @param array<string, mixed> $variables
     *
     * @return array<string, mixed>
     *
     * @throws AnilistException
     */
    private function request(string $query, array $variables): array
    {
        $attempt = 0;

        while (true) {
            ++$attempt;
            $this->throttle();

            try {
                $response = $this->httpClient->request('POST', $this->endpoint, [
                    'headers' => [
                        'Content-Type' => 'application/json',
                        'Accept' => 'application/json',
                    ],
                    'json' => ['query' => $query, 'variables' => $variables],
                    'timeout' => 30,
                ]);

                $status = $response->getStatusCode();
                $headers = $response->getHeaders(false);

                if (429 === $status) {
                    $this->waitAfterRateLimit($headers, $attempt);
                    if ($attempt > $this->maxRetries) {
                        throw new AnilistException('AniList : quota épuisé, abandon après '.$this->maxRetries.' tentatives.');
                    }
                    continue;
                }

                if ($status >= 500) {
                    if ($attempt > $this->maxRetries) {
                        throw new AnilistException(\sprintf('AniList : erreur serveur HTTP %d persistante.', $status));
                    }
                    $this->backoff($attempt);
                    continue;
                }

                $content = $response->getContent(false);
                /** @var array<string, mixed>|null $decoded */
                $decoded = json_decode($content, true);

                if (!\is_array($decoded)) {
                    throw new AnilistException(\sprintf('AniList : réponse illisible (HTTP %d).', $status));
                }

                if ($status >= 400 || isset($decoded['errors'])) {
                    throw new AnilistException(\sprintf(
                        'AniList : erreur GraphQL (HTTP %d) — %s',
                        $status,
                        json_encode($decoded['errors'] ?? $decoded, \JSON_UNESCAPED_UNICODE) ?: 'détail indisponible',
                    ));
                }

                $this->respectRemainingQuota($headers);

                return $decoded;
            } catch (HttpExceptionInterface $e) {
                if ($attempt > $this->maxRetries) {
                    throw new AnilistException('AniList : échec réseau — '.$e->getMessage(), previous: $e);
                }
                $this->logger->warning('AniList : échec réseau, nouvelle tentative.', [
                    'attempt' => $attempt,
                    'error' => $e->getMessage(),
                ]);
                $this->backoff($attempt);
            }
        }
    }

    /**
     * Garantit l'intervalle minimal entre deux requêtes sortantes.
     */
    private function throttle(): void
    {
        if (0.0 === $this->lastRequestAt) {
            $this->lastRequestAt = microtime(true);

            return;
        }

        $elapsed = microtime(true) - $this->lastRequestAt;
        if ($elapsed < $this->minIntervalSeconds) {
            $this->sleep($this->minIntervalSeconds - $elapsed);
        }

        $this->lastRequestAt = microtime(true);
    }

    /**
     * @param array<string, list<string>> $headers
     */
    private function respectRemainingQuota(array $headers): void
    {
        $remaining = $this->headerInt($headers, 'x-ratelimit-remaining');
        if (null === $remaining || $remaining > self::REMAINING_THRESHOLD) {
            return;
        }

        $reset = $this->headerInt($headers, 'x-ratelimit-reset');
        $wait = null !== $reset ? (float) $reset - time() : 60.0;

        if ($wait > 0) {
            $this->logger->info('AniList : quota presque épuisé, mise en pause.', [
                'remaining' => $remaining,
                'wait_seconds' => $wait,
            ]);
            $this->sleep($wait);
        }
    }

    /**
     * @param array<string, list<string>> $headers
     */
    private function waitAfterRateLimit(array $headers, int $attempt): void
    {
        $retryAfter = $this->headerInt($headers, 'retry-after');
        $wait = null !== $retryAfter ? (float) $retryAfter + 1.0 : min(60.0, 2 ** $attempt);

        $this->logger->warning('AniList : HTTP 429, attente avant reprise.', [
            'attempt' => $attempt,
            'wait_seconds' => $wait,
        ]);

        $this->sleep($wait);
    }

    private function backoff(int $attempt): void
    {
        $this->sleep(min(30.0, 2 ** $attempt) + (random_int(0, 500) / 1000));
    }

    /**
     * @param array<string, list<string>> $headers
     */
    private function headerInt(array $headers, string $name): ?int
    {
        $value = $headers[$name][0] ?? null;

        return is_numeric($value) ? (int) $value : null;
    }

    /**
     * Point d'extension : surchargé dans les tests pour ne pas dormir réellement.
     */
    protected function sleep(float $seconds): void
    {
        $seconds = min(max($seconds, 0.0), self::MAX_WAIT_SECONDS);
        if ($seconds > 0) {
            usleep((int) round($seconds * 1_000_000));
        }
    }
}
