import Image from 'next/image';

/**
 * "The Knowledge Graph Conference in Your Words".
 *
 * A correction worth recording: these five files live under
 * `public/kgc/testimonials/` and the asset inventory calls them a "partner/sponsor
 * logo strip". **They are not logos.** Each one is a rendered testimonial card
 * — a pull quote, a headshot, a name, an employer and a job title — and on the
 * live site they are the slides of the carousel under this exact heading. The
 * directory name is wrong; the files are right, so they are used here for what
 * they actually are and left where they are rather than renamed under a peer
 * agent's feet.
 *
 * The live carousel is a Splide instance that auto-advances. This is a
 * scroll-snapping strip instead: it needs no JavaScript, it is operable by
 * keyboard and trackpad alike, and nothing moves under a reader mid-sentence.
 * The quotes are baked into the images, so each slide carries the quotation as
 * alt text — otherwise the whole section is empty to a screen reader.
 */
export interface Testimonial {
  file: string;
  quote: string;
  who: string;
}

export function Testimonials({ heading, items }: { heading: string; items: Testimonial[] }) {
  return (
    <section className="kgc-quotes" aria-label="What attendees say">
      <h2 className="kgc-quotes-heading">{heading}</h2>
      <ul className="kgc-quotes-strip" tabIndex={0}>
        {items.map((t) => (
          <li key={t.file}>
            <Image
              src={`/kgc/testimonials/${t.file}`}
              alt={`“${t.quote}” — ${t.who}`}
              width={1024}
              height={291}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
