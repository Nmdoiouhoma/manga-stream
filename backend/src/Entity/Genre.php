<?php

declare(strict_types=1);

namespace App\Entity;

use ApiPlatform\Doctrine\Orm\Filter\OrderFilter;
use ApiPlatform\Doctrine\Orm\Filter\SearchFilter;
use ApiPlatform\Metadata\ApiFilter;
use ApiPlatform\Metadata\ApiResource;
use ApiPlatform\Metadata\Delete;
use ApiPlatform\Metadata\Get;
use ApiPlatform\Metadata\GetCollection;
use ApiPlatform\Metadata\Patch;
use ApiPlatform\Metadata\Post;
use ApiPlatform\Metadata\Put;
use App\Repository\GenreRepository;
use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Serializer\Attribute\Groups;
use Symfony\Component\Validator\Constraints as Assert;

#[ORM\Entity(repositoryClass: GenreRepository::class)]
#[ORM\Table(name: 'genre')]
#[ORM\UniqueConstraint(name: 'uniq_genre_name', columns: ['name'])]
#[ORM\UniqueConstraint(name: 'uniq_genre_slug', columns: ['slug'])]
#[ApiResource(
    shortName: 'Genre',
    description: 'Genre (Action, Romance, Shonen, ...) partagé par les animes et les mangas.',
    operations: [
        new GetCollection(),
        new Get(normalizationContext: ['groups' => ['genre:read', 'genre:item:read']]),
        new Post(),
        new Put(),
        new Patch(),
        new Delete(),
    ],
    normalizationContext: ['groups' => ['genre:read']],
    denormalizationContext: ['groups' => ['genre:write']],
    order: ['name' => 'ASC'],
)]
#[ApiFilter(SearchFilter::class, properties: ['name' => 'ipartial', 'slug' => 'exact'])]
#[ApiFilter(OrderFilter::class, properties: ['name', 'slug'])]
class Genre
{
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column]
    #[Groups(['genre:read', 'anime:read', 'manga:read'])]
    private ?int $id = null;

    #[ORM\Column(length: 100, unique: true)]
    #[Assert\NotBlank]
    #[Assert\Length(max: 100)]
    #[Groups(['genre:read', 'genre:write', 'anime:read', 'manga:read'])]
    private string $name = '';

    #[ORM\Column(length: 120, unique: true)]
    #[Assert\NotBlank]
    #[Assert\Length(max: 120)]
    #[Assert\Regex(pattern: '/^[a-z0-9]+(?:-[a-z0-9]+)*$/', message: 'Le slug doit être en minuscules, sans accent, séparé par des tirets.')]
    #[Groups(['genre:read', 'genre:write', 'anime:read', 'manga:read'])]
    private string $slug = '';

    /** @var Collection<int, Anime> */
    #[ORM\ManyToMany(targetEntity: Anime::class, mappedBy: 'genres')]
    #[Groups(['genre:item:read'])]
    private Collection $animes;

    /** @var Collection<int, Manga> */
    #[ORM\ManyToMany(targetEntity: Manga::class, mappedBy: 'genres')]
    #[Groups(['genre:item:read'])]
    private Collection $mangas;

    public function __construct()
    {
        $this->animes = new ArrayCollection();
        $this->mangas = new ArrayCollection();
    }

    public function getId(): ?int
    {
        return $this->id;
    }

    public function getName(): string
    {
        return $this->name;
    }

    public function setName(string $name): static
    {
        $this->name = $name;

        return $this;
    }

    public function getSlug(): string
    {
        return $this->slug;
    }

    public function setSlug(string $slug): static
    {
        $this->slug = $slug;

        return $this;
    }

    /** @return Collection<int, Anime> */
    public function getAnimes(): Collection
    {
        return $this->animes;
    }

    public function addAnime(Anime $anime): static
    {
        if (!$this->animes->contains($anime)) {
            $this->animes->add($anime);
            $anime->addGenre($this);
        }

        return $this;
    }

    public function removeAnime(Anime $anime): static
    {
        if ($this->animes->removeElement($anime)) {
            $anime->removeGenre($this);
        }

        return $this;
    }

    /** @return Collection<int, Manga> */
    public function getMangas(): Collection
    {
        return $this->mangas;
    }

    public function addManga(Manga $manga): static
    {
        if (!$this->mangas->contains($manga)) {
            $this->mangas->add($manga);
            $manga->addGenre($this);
        }

        return $this;
    }

    public function removeManga(Manga $manga): static
    {
        if ($this->mangas->removeElement($manga)) {
            $manga->removeGenre($this);
        }

        return $this;
    }

    public function __toString(): string
    {
        return $this->name;
    }
}
