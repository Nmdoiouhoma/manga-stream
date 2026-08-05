/**
 * Le mark de manga-stream, en SVG inline.
 *
 * ── Pourquoi inline et pas `<img src="/favicon.svg">` ─────────────────────
 * Le mark est posé sur un fond sombre dans la barre du haut : la coche doit
 * s'y découper, donc reprendre la couleur du fond de l'application plutôt
 * qu'un noir fixe. `currentColor` ne suffirait pas — il n'y a qu'une couleur
 * héritée, et le mark en demande deux. Inline, la coche lit directement
 * `var(--bg)`, et le mark suit un éventuel changement de thème sans qu'on ait
 * à maintenir deux fichiers.
 *
 * Le `.svg` de `public/` reste, lui, autonome : un favicon n'a pas de feuille
 * de style. C'est la seule duplication du tracé, et elle est assumée.
 *
 * ── Décoratif ─────────────────────────────────────────────────────────────
 * Le nom « manga stream » est écrit juste à côté, en toutes lettres. Le mark
 * n'ajoute donc aucune information pour un lecteur d'écran.
 */
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      className="brand__mark"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="brand-mark-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--anime)" />
        </linearGradient>
      </defs>

      <path
        fill="url(#brand-mark-gradient)"
        d="M9 2.5h14a3.5 3.5 0 0 1 3.5 3.5v22.4a1.4 1.4 0 0 1-2.24 1.12L16 23.4l-8.26 6.12A1.4 1.4 0 0 1 5.5 28.4V6A3.5 3.5 0 0 1 9 2.5z"
      />

      <path
        fill="none"
        stroke="var(--bg)"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m10.8 12.6 3.6 3.6 6.8-6.8"
      />
    </svg>
  )
}
