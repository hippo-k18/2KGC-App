import type { ReactNode } from 'react';
import Image from 'next/image';

/**
 * A full-bleed two-column band: one photograph, one block of prose.
 *
 * The live homepage uses this shape twice — "Why Attend" (photo left, on
 * `--palette-1`) and the HCLS symposium (photo right, same ink) — with the
 * measured 525/803 column split and `80px 24px` padding. Both are the same
 * component here because they are the same design, and the page builder only
 * duplicated them because a page builder cannot factor.
 *
 * `aspect` carries the measured render ratio of each photograph rather than its
 * intrinsic one: the live site crops these to fixed boxes, so 1600×1200 renders
 * at 4/3 and 1919×1536 at 5/4.
 */
export interface PhotoSplitProps {
  id?: string;
  heading: string;
  children: ReactNode;
  photo: string;
  /** Alt text. These are documentary photographs, so they get described. */
  alt: string;
  aspect: string;
  /** Which side the photograph sits on. Defaults to the left, as "Why Attend". */
  photoSide?: 'left' | 'right';
  /** `--palette-1` unless told otherwise; the live bands alternate ink. */
  tone?: 'ink' | 'navy';
  /**
   * "Why Attend" measures 525/803 — a narrow photo beside wide prose. The HCLS
   * band is `kt-row-layout-equal`, 664/664. Both are real, so both are here.
   */
  columns?: 'uneven' | 'equal';
  footer?: ReactNode;
}

export function PhotoSplit({
  id,
  heading,
  children,
  photo,
  alt,
  aspect,
  photoSide = 'left',
  tone = 'ink',
  columns = 'uneven',
  footer,
}: PhotoSplitProps) {
  const figure = (
    <div className="kgc-split-photo" style={{ aspectRatio: aspect }}>
      <Image src={photo} alt={alt} fill sizes="(max-width: 900px) 100vw, 40vw" />
    </div>
  );

  const prose = (
    <div className="kgc-split-prose">
      <h2>{heading}</h2>
      {children}
      {footer}
    </div>
  );

  return (
    <section id={id} className={`kgc-split kgc-tone-${tone}`}>
      <div className={`kgc-wide kgc-split-row kgc-split-${columns} kgc-photo-${photoSide}`}>
        {photoSide === 'left' ? (
          <>
            {figure}
            {prose}
          </>
        ) : (
          <>
            {prose}
            {figure}
          </>
        )}
      </div>
    </section>
  );
}
