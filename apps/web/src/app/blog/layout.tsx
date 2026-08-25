/**
 * The blog index and its posts sit on a darker page than the rest of the site.
 *
 * Measured: the live blog renders `body` at `rgb(224, 229, 238)` — `--palette-3`
 * — where every other page is `--palette-8`. It is the one route on the site
 * that changes its page colour, and ours was on the lighter background
 * throughout, which is why blog cards read as flatter than theirs: white cards
 * on near-white instead of white cards on blue-grey.
 *
 * A wrapper rather than a `body` class, because `body` belongs to the root
 * layout and this is the only route that wants it. `main` is full width, so the
 * background is full-bleed without any negative-margin trickery, and
 * `min-height` keeps it covering the viewport on a short post.
 */
export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="blog-page" style={{ background: 'var(--palette-3)', minHeight: '70vh' }}>
      {children}
    </div>
  );
}
