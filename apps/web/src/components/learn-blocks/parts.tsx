import Image from 'next/image';
import type { CSSProperties, ReactNode } from 'react';
import { focalPosition, isStorageImageSrc, type LinkButton, type PageImage } from '@kgc/shared';

/*
 * Learn page v2 blocks (T319), shared by the website (`apps/web/src/components/
 * learn-blocks/`) and the dashboard preview (`apps/organizer/.../learn-page/
 * preview-blocks/`). The two folders hold the same files byte for byte, and a
 * test fails if they drift: the apps cannot import each other, and a twin that
 * is "nearly" the same is how a preview stops matching the page.
 */

/** What every block needs to know about where it is drawn. */
export interface BlockCtx {
  /** Prefix for site asset paths (`/kgc/...`): empty on the website, its origin in the dashboard. */
  assetOrigin: string;
  /** `optimize` sends Storage images through `next/image` (the website); `plain` serves them as they are. */
  remoteImages: 'optimize' | 'plain';
  /** Mutable: the first image on the page loads with priority. */
  firstImage: { used: boolean };
  /** Heading block id to the id it is drawn with (`headingIds`), for the table of contents. */
  headingIds: ReadonlyMap<string, string>;
  /** Server time for the countdown's first paint, so the client's first render matches. */
  now: number;
}

export function imageSrc(image: PageImage, ctx: Pick<BlockCtx, 'assetOrigin'>): string {
  return image.src.startsWith('/') ? `${ctx.assetOrigin}${image.src}` : image.src;
}

export function imageOptimized(image: PageImage, ctx: Pick<BlockCtx, 'assetOrigin' | 'remoteImages'>): boolean {
  return image.src.startsWith('/') ? !ctx.assetOrigin : ctx.remoteImages === 'optimize' && isStorageImageSrc(image.src);
}

/** Takes the page's single priority image slot, if it is still free. */
export function takePriority(ctx: BlockCtx): boolean {
  const priority = !ctx.firstImage.used;
  ctx.firstImage.used = true;
  return priority;
}

/**
 * An image with its stored width and height, so the browser reserves its box
 * before it loads (no layout shift).
 */
export function Picture({
  image,
  ctx,
  className,
  sizes,
  alt,
  priority,
}: {
  image: PageImage;
  ctx: BlockCtx;
  className?: string;
  sizes?: string;
  alt?: string;
  priority?: boolean;
}) {
  const objectPosition = focalPosition(image);
  return (
    <Image
      src={imageSrc(image, ctx)}
      alt={alt ?? image.alt}
      width={image.width}
      height={image.height}
      className={className}
      sizes={sizes}
      priority={priority ?? takePriority(ctx)}
      unoptimized={!imageOptimized(image, ctx)}
      style={objectPosition ? { objectPosition } : undefined}
    />
  );
}

/** A photo that fills its box (a section background), cropped at its focal point. */
export function FillPicture({ image, ctx, className }: { image: PageImage; ctx: BlockCtx; className?: string }) {
  return (
    <Image
      src={imageSrc(image, ctx)}
      alt=""
      fill
      sizes="100vw"
      className={className}
      priority={takePriority(ctx)}
      unoptimized={!imageOptimized(image, ctx)}
      style={{ objectFit: 'cover', objectPosition: focalPosition(image) ?? 'center' }}
    />
  );
}

/** Our own pages, anchors and `mailto:` keep the tab; other sites (or a link set to) open a new one. */
export function SmartLink({
  href,
  className,
  newTab,
  children,
  style,
}: {
  href: string;
  className?: string;
  newTab?: boolean;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const external = newTab ?? /^https?:\/\//i.test(href);
  return external ? (
    <a href={href} className={className} style={style} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ) : (
    <a href={href} className={className} style={style}>
      {children}
    </a>
  );
}

export function Button({ button }: { button: LinkButton }) {
  const cls =
    button.style === 'primary'
      ? 'btn btn-primary lp-btn'
      : button.style === 'secondary'
        ? 'btn btn-secondary lp-btn'
        : 'lp-btn-text';
  return (
    <SmartLink href={button.href} className={cls}>
      {button.label}
    </SmartLink>
  );
}

/** A link as the list and column blocks draw it: a text link inline, or a button. */
export function ItemLink({ link }: { link: LinkButton }) {
  return link.style === 'text' ? <SmartLink href={link.href}>{link.label}</SmartLink> : <Button button={link} />;
}
