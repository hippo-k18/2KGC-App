'use client';

import type { CSSProperties } from 'react';
import type { ImageShape, LinkButton, PageImage } from '@kgc/shared';
import { previewFraction, previewHref, previewPick, previewPixels } from '@/lib/learn-editor-core';
import { resolveSrc } from './editor-types';

const IMAGE_SHAPES = ['square', 'rounded', 'circle', 'original'] as const;
const BUTTON_STYLES = ['primary', 'secondary', 'text'] as const;

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
  // Every stored value is checked before it reaches a class, a style or an attribute (T320).
  const safeShape = previewPick(shape, IMAGE_SHAPES, 'original');
  const crop = safeShape === 'square' || safeShape === 'circle';
  const width = previewPixels(image.width);
  const height = previewPixels(image.height);
  const ratio = width > 0 && height > 0 ? `${width} / ${height}` : undefined;
  if (!image.src || typeof image.src !== 'string') {
    // Not chosen yet: stored in the draft, refused at publish, skipped on www.
    return (
      <div
        className={`lp-img-empty lp-shape-${safeShape} ${className ?? ''}`}
        style={{ aspectRatio: crop ? '1 / 1' : fill ? undefined : ratio ?? '16 / 9' }}
      >
        Choose an image
      </div>
    );
  }
  const style: CSSProperties = {
    objectPosition: `${previewFraction(image.focusX) * 100}% ${previewFraction(image.focusY) * 100}%`,
    aspectRatio: crop ? '1 / 1' : fill ? undefined : ratio,
  };
  return (
    // Site assets and Storage URLs from any origin; next/image would need each host configured.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={`lp-img lp-shape-${safeShape} ${fill ? 'lp-img-fill ' : ''}${className ?? ''}`}
      src={resolveSrc(image.src, siteOrigin)}
      alt={typeof image.alt === 'string' ? image.alt : ''}
      width={width || undefined}
      height={height || undefined}
      style={style}
      loading="lazy"
      decoding="async"
    />
  );
}

export function TextLink({ link }: { link: LinkButton }) {
  return (
    <a className="lp-textlink" href={previewHref(link.href)}>
      {link.label}
    </a>
  );
}

export function ButtonRow({ buttons }: { buttons: LinkButton[] }) {
  return (
    <div className="lp-buttons">
      {buttons.map((b, i) => (
        <a key={i} className={`lp-btn lp-btn-${previewPick(b.style, BUTTON_STYLES, 'primary')}`} href={previewHref(b.href)}>
          {b.label}
        </a>
      ))}
    </div>
  );
}
