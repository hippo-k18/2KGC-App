'use client';

import type { CSSProperties } from 'react';
import { isSafeHref, type ImageShape, type LinkButton, type PageImage } from '@kgc/shared';
import { resolveSrc } from './editor-types';

/** Pieces the v1 and v2 preview blocks share (split out of `preview.tsx` in T318). */

export function Picture({
  image,
  shape,
  siteOrigin,
  className,
  fill,
}: {
  image: PageImage;
  shape: ImageShape;
  siteOrigin: string;
  className?: string;
  /** Cover the box it is in (gallery tiles, card tops) instead of keeping the file's shape. */
  fill?: boolean;
}) {
  const crop = shape === 'square' || shape === 'circle';
  const ratio = image.width > 0 && image.height > 0 ? `${image.width} / ${image.height}` : undefined;
  if (!image.src) {
    return (
      <div
        className={`lp-img-empty lp-shape-${shape} ${className ?? ''}`}
        style={{ aspectRatio: crop ? '1 / 1' : fill ? undefined : ratio ?? '16 / 9' }}
      >
        No image yet
      </div>
    );
  }
  const style: CSSProperties = {
    objectPosition: `${(image.focusX ?? 0.5) * 100}% ${(image.focusY ?? 0.5) * 100}%`,
    aspectRatio: crop ? '1 / 1' : fill ? undefined : ratio,
  };
  return (
    // Site assets and Storage URLs from any origin; next/image would need each host configured.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={`lp-img lp-shape-${shape} ${fill ? 'lp-img-fill ' : ''}${className ?? ''}`}
      src={resolveSrc(image.src, siteOrigin)}
      alt={image.alt}
      width={image.width || undefined}
      height={image.height || undefined}
      style={style}
      loading="lazy"
      decoding="async"
    />
  );
}

export function TextLink({ link }: { link: LinkButton }) {
  return (
    <a className="lp-textlink" href={isSafeHref(link.href) ? link.href : undefined}>
      {link.label}
    </a>
  );
}

export function ButtonRow({ buttons }: { buttons: LinkButton[] }) {
  return (
    <div className="lp-buttons">
      {buttons.map((b, i) => (
        <a key={i} className={`lp-btn lp-btn-${b.style}`} href={isSafeHref(b.href) ? b.href : undefined}>
          {b.label}
        </a>
      ))}
    </div>
  );
}
