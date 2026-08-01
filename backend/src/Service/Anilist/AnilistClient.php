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
              averageScore
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
