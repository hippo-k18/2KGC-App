/**
 * "The Knowledge Graph Conference in Your Words".
 *
 * ## Why these are typeset and not images any more
 *
 * The five files under `public/kgc/testimonials/` are the live site's carousel
 * slides, and each one is a *rendered picture of a quotation* — the words are
 * pixels. Using them meant the quotes could not be selected, searched, indexed
 * or resized; they carried their own typography rather than the site's, so the
 * type inside slide one was visibly a different size from slide two at the same
 * render width; and on a phone they were upscaled and soft. The fifth was also
 * the one nobody ever saw, because it sat off the end of a horizontally
 * scrolling strip with no affordance and its lazy load never fired.
 *
 * Every quote was already transcribed into `TESTIMONIALS` in `page.tsx` — the
 * component was passing it as `alt` text and then drawing the picture anyway. So
 * the text was always there; it was just not the thing being displayed.
 *
 * The images are left in the repository rather than deleted: they are the
 * primary source for these transcriptions, and anyone checking a quote should be
 * able to find the original.
 *
 * The layout is a scroll-snapping strip rather than the live site's
 * auto-advancing Splide carousel. It needs no JavaScript, it is operable by
 * keyboard and trackpad alike, and nothing moves under a reader mid-sentence.
 */
export interface Testimonial {
  file: string;
  quote: string;
  /** "Name, Job Title, Employer" — as printed on the original slide. */
  who: string;
}

/** Initials for the fallback portrait. Two at most, so the disc stays legible. */
function initials(who: string): string {
  return who
    .split(',')[0]
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export function Testimonials({ heading, items }: { heading: string; items: Testimonial[] }) {
  return (
    <section className="kgc-quotes" aria-label="What attendees say">
      <h2 className="kgc-quotes-heading">{heading}</h2>
      <ul className="kgc-quotes-strip">
        {items.map((t) => {
          const [name, ...rest] = t.who.split(',').map((s) => s.trim());
          return (
            <li key={t.file} className="kgc-quote">
              <figure>
                <blockquote>{t.quote}</blockquote>
                <figcaption>
                  <span className="kgc-quote-mark" aria-hidden="true">
                    {initials(t.who)}
                  </span>
                  <span className="kgc-quote-who">
                    <strong>{name}</strong>
                    {rest.length ? <span>{rest.join(', ')}</span> : null}
                  </span>
                </figcaption>
              </figure>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
