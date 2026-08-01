<?php

declare(strict_types=1);

namespace App\Service\Anilist;

use App\Enum\AnimeSeason;
use App\Enum\MediaStatus;

/**
 * Représentation normalisée d'un média AniList.
 *
 * Ce DTO isole complètement le parsing de la couche HTTP : `fromApiNode()` est une
 * fonction pure qui transforme un nœud brut de la réponse GraphQL en objet typé,
 * ce qui permet de tester le parsing sur une réponse figée, sans appel réseau.
 */
final readonly class AnilistMedia
{
    /**
     * @param list<string> $genres
     */
    public function __construct(
        public int $anilistId,
        public string $type,
        public string $titleRomaji,
        public ?string $titleEnglish,
        public ?string $titleNative,
        public ?string $synopsis,
        public ?string $coverImage,
        public ?string $bannerImage,
        public ?int $episodes,
        public ?int $chapters,
        public ?int $volumes,
        public ?int $averageScore,
        public ?MediaStatus $status,
        public ?AnimeSeason $season,
        public ?int $seasonYear,
        public ?\DateTimeImmutable $startDate,
        public ?\DateTimeImmutable $endDate,
        public array $genres,
    ) {
    }

    public const TYPE_ANIME = 'ANIME';
    public const TYPE_MANGA = 'MANGA';

    /**
     * Construit le DTO depuis un nœud `Page.media` de l'API AniList.
     *
     * Tolérant par conception : AniList renvoie `null` sur la quasi-totalité des
     * champs, et un titre romaji manquant est comblé par l'anglais ou le natif.
     *
     * @param array<string, mixed> $node
     *
     * @throws \InvalidArgumentException si le nœud n'est pas exploitable (pas d'id ou aucun titre)
     */
    public static function fromApiNode(array $node): self
    {
        $anilistId = $node['id'] ?? null;
        if (!\is_int($anilistId) || $anilistId <= 0) {
            throw new \InvalidArgumentException('Nœud AniList sans identifiant exploitable.');
        }

        $titles = \is_array($node['title'] ?? null) ? $node['title'] : [];
        $romaji = self::str($titles['romaji'] ?? null, 255);
        $english = self::str($titles['english'] ?? null, 255);
        $native = self::str($titles['native'] ?? null, 255);

        $primary = $romaji ?? $english ?? $native;
        if (null === $primary) {
            throw new \InvalidArgumentException(\sprintf('Média AniList #%d sans aucun titre.', $anilistId));
        }

        $cover = \is_array($node['coverImage'] ?? null) ? $node['coverImage'] : [];

        return new self(
            anilistId: $anilistId,
            type: self::TYPE_MANGA === ($node['type'] ?? null) ? self::TYPE_MANGA : self::TYPE_ANIME,
            titleRomaji: $primary,
            titleEnglish: $english,
            titleNative: $native,
            synopsis: self::cleanDescription($node['description'] ?? null),
            coverImage: self::str($cover['extraLarge'] ?? $cover['large'] ?? $cover['medium'] ?? null, 512),
            bannerImage: self::str($node['bannerImage'] ?? null, 512),
            episodes: self::positiveInt($node['episodes'] ?? null),
            chapters: self::positiveInt($node['chapters'] ?? null),
            volumes: self::positiveInt($node['volumes'] ?? null),
            averageScore: self::score($node['averageScore'] ?? null),
            status: self::enum(MediaStatus::class, $node['status'] ?? null),
            season: self::enum(AnimeSeason::class, $node['season'] ?? null),
            seasonYear: self::year($node['seasonYear'] ?? null),
            startDate: self::fuzzyDate($node['startDate'] ?? null),
            endDate: self::fuzzyDate($node['endDate'] ?? null),
            genres: self::genres($node['genres'] ?? null),
        );
    }

    public function isAnime(): bool
    {
        return self::TYPE_ANIME === $this->type;
    }

    private static function str(mixed $value, int $maxLength): ?string
    {
        if (!\is_string($value)) {
            return null;
        }

        $value = trim($value);
        if ('' === $value) {
            return null;
        }

        return mb_substr($value, 0, $maxLength);
    }

    /**
     * Les synopsis AniList contiennent du HTML léger (`<br>`, `<i>`, entités).
     * On le réduit en texte brut pour ne pas exposer de balises côté frontend.
     */
    private static function cleanDescription(mixed $value): ?string
    {
        if (!\is_string($value)) {
            return null;
        }

        $text = preg_replace('#<br\s*/?>#i', "\n", $value) ?? $value;
        $text = strip_tags($text);
        $text = html_entity_decode($text, \ENT_QUOTES | \ENT_HTML5, 'UTF-8');
        $text = preg_replace("/\n{3,}/", "\n\n", $text) ?? $text;
        $text = trim($text);

        return '' === $text ? null : $text;
    }

    private static function positiveInt(mixed $value): ?int
    {
        if (!\is_int($value) && !(\is_string($value) && ctype_digit($value))) {
            return null;
        }

        $value = (int) $value;

        return $value > 0 ? $value : null;
    }

    private static function score(mixed $value): ?int
    {
        if (!is_numeric($value)) {
            return null;
        }

        $value = (int) round((float) $value);

        return $value >= 0 && $value <= 100 ? $value : null;
    }

    private static function year(mixed $value): ?int
    {
        if (!is_numeric($value)) {
            return null;
        }

        $value = (int) $value;

        return $value >= 1900 && $value <= 2200 ? $value : null;
    }

    /**
     * @template T of \BackedEnum
     *
     * @param class-string<T> $enumClass
     *
     * @return T|null
     */
    private static function enum(string $enumClass, mixed $value): ?\BackedEnum
    {
        return \is_string($value) ? $enumClass::tryFrom($value) : null;
    }

    /**
     * AniList utilise des « fuzzy dates » : `{year, month, day}` dont chaque
     * composante peut être nulle. Sans année exploitable, on ne date pas.
     */
    private static function fuzzyDate(mixed $value): ?\DateTimeImmutable
    {
        if (!\is_array($value)) {
            return null;
        }

        $year = self::year($value['year'] ?? null);
        if (null === $year) {
            return null;
        }

        $month = is_numeric($value['month'] ?? null) ? max(1, min(12, (int) $value['month'])) : 1;
        $day = is_numeric($value['day'] ?? null) ? max(1, min(31, (int) $value['day'])) : 1;

        $date = \DateTimeImmutable::createFromFormat('!Y-n-j', \sprintf('%d-%d-%d', $year, $month, $day));

        return false === $date ? null : $date;
    }

    /**
     * @return list<string>
     */
    private static function genres(mixed $value): array
    {
        if (!\is_array($value)) {
            return [];
        }

        $genres = [];
        foreach ($value as $genre) {
            $genre = self::str($genre, 100);
            if (null !== $genre) {
                $genres[$genre] = true;
            }
        }

        return array_keys($genres);
    }
}
