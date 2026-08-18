import type { ReactNode } from 'react';
import Image from 'next/image';

/**
 * The "#1 Invaluable Workshops" / "#2 Networking Opportunities" band.
 *
 * Two equal 664px columns on `--navy`, each a photograph above a 20px/800
 * white heading and a 22px/35.2px paragraph in `--palette-3`. Measured, not
 * guessed.
 *
 * **Two live-site defects are not reproduced here**, and both are legibility
 * rather than layout:
 *
 * 1. The live copy reads "*Limitied availability". It is a typo; it is spelled
 *    correctly here.
 * 2. The live "Learn more →" is a plain paragraph coloured `--palette-2` — the
 *    same navy as the band behind it — so it renders invisible and is not a
 *    link to anywhere. Ours is a real anchor in `--palette-4`, which is the
 *    theme's own light blue and clears 4.5:1 on the navy.
 */
export interface Highlight {
  heading: string;
  photo: string;
  alt: string;
  /** Measured render ratio of the live photograph, e.g. `'3 / 2'`. */
  aspect: string;
  body: ReactNode;
  note?: string;
  link?: { label: string; href: string };
}

export function HighlightPair({ items }: { items: [Highlight, Highlight] }) {
  return (
    <section className="kgc-pair" aria-label="Conference highlights">
      <div className="kgc-wide kgc-pair-row">
        {items.map((h) => (
          <div className="kgc-pair-item" key={h.heading}>
            <div className="kgc-pair-photo" style={{ aspectRatio: h.aspect }}>
              <Image src={h.photo} alt={h.alt} fill sizes="(max-width: 900px) 100vw, 46vw" />
            </div>
            <h2>{h.heading}</h2>
            <p className="kgc-pair-body">{h.body}</p>
            {h.note && <p className="kgc-pair-note">{h.note}</p>}
            {h.link && (
              <p className="kgc-pair-link">
                <a href={h.link.href}>{h.link.label} →</a>
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
