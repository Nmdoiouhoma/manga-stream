<?php

declare(strict_types=1);

namespace App\Filter;

use ApiPlatform\Doctrine\Orm\Filter\AbstractFilter;
use ApiPlatform\Doctrine\Orm\Util\QueryNameGeneratorInterface;
use ApiPlatform\Metadata\Operation;
use Doctrine\ORM\QueryBuilder;

/**
 * Filtre `?title=...` combinant les trois colonnes de titre en **OU**.
 *
 * Les `SearchFilter` natifs d'API Platform sur `titleRomaji`, `titleEnglish` et
 * `titleNative` sont combinés en ET : chercher « Attack on Titan » ne remonte rien
 * lorsque le titre romaji stocké est « Shingeki no Kyojin ». Ce filtre applique une
 * unique clause `WHERE (LOWER(romaji) LIKE :t OR LOWER(english) LIKE :t OR LOWER(native) LIKE :t)`,
 * insensible à la casse et en correspondance partielle.
 *
 * Les filtres existants sont conservés : ce filtre est purement additif.
 */
final class CombinedTitleFilter extends AbstractFilter
{
    public const PARAMETER_NAME = 'title';

    /** @var list<string> */
    private const TITLE_FIELDS = ['titleRomaji', 'titleEnglish', 'titleNative'];

    protected function filterProperty(
        string $property,
        mixed $value,
        QueryBuilder $queryBuilder,
        QueryNameGeneratorInterface $queryNameGenerator,
        string $resourceClass,
        ?Operation $operation = null,
        array $context = [],
    ): void {
        if (self::PARAMETER_NAME !== $property) {
            return;
        }

        if (\is_array($value)) {
            $value = reset($value);
        }

        if (!\is_string($value)) {
            return;
        }

        $needle = trim($value);
        if ('' === $needle) {
            return;
        }

        $fields = $this->supportedFields($resourceClass);
        if ([] === $fields) {
            return;
        }

        $alias = $queryBuilder->getRootAliases()[0];
        $parameterName = $queryNameGenerator->generateParameterName(self::PARAMETER_NAME);
        $expr = $queryBuilder->expr();

        $orX = $expr->orX();
        foreach ($fields as $field) {
            $orX->add($expr->like(\sprintf('LOWER(%s.%s)', $alias, $field), ':'.$parameterName));
        }

        $queryBuilder
            ->andWhere($orX)
            ->setParameter($parameterName, '%'.self::escapeLike(mb_strtolower($needle)).'%');
    }

    /**
     * {@inheritdoc}
     */
    public function getDescription(string $resourceClass): array
    {
        if ([] === $this->supportedFields($resourceClass)) {
            return [];
        }

        $description = 'Recherche partielle insensible à la casse sur les titres romaji, anglais et natif, combinés en OU.';

        return [
            self::PARAMETER_NAME => [
                'property' => self::PARAMETER_NAME,
                'type' => 'string',
                'required' => false,
                'description' => $description,
                'openapi' => [
                    'description' => $description,
                    'example' => 'attack on titan',
                ],
            ],
        ];
    }

    /**
     * Ne conserve que les colonnes de titre réellement mappées sur la ressource,
     * afin que le filtre reste inoffensif s'il est posé sur une autre entité.
     *
     * @param class-string $resourceClass
     *
     * @return list<string>
     */
    private function supportedFields(string $resourceClass): array
    {
        if (!$this->hasManagerRegistry()) {
            return self::TITLE_FIELDS;
        }

        $manager = $this->getManagerRegistry()->getManagerForClass($resourceClass);
        if (null === $manager) {
            return [];
        }

        $metadata = $manager->getClassMetadata($resourceClass);

        return array_values(array_filter(
            self::TITLE_FIELDS,
            static fn (string $field): bool => $metadata->hasField($field),
        ));
    }

    /**
     * Neutralise les jokers SQL saisis par l'utilisateur.
     */
    private static function escapeLike(string $value): string
    {
        return str_replace(['\\', '%', '_'], ['\\\\', '\%', '\_'], $value);
    }
}
