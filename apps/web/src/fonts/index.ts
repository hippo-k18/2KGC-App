import localFont from 'next/font/local';

/**
 * The site's two families, self-hosted through `next/font`.
 *
 * Same files and descriptors as the `@font-face` rules they replace (see the
 * note in `globals.css`): Open Sans as two variable faces, `wght` 300–800,
 * upright and italic, and Roboto 400 for the navigation. What `next/font` adds:
 * the files get hashed names under `/_next/static/media`, cached for a year;
 * Open Sans is preloaded, so it is found with the HTML instead of after the
 * stylesheet; and each family gets an Arial fallback scaled to its metrics, so
 * text set in the fallback takes the same space and nothing moves when the real
 * face arrives (the blog's lede moved by 0.23 CLS on desktop without it).
 *
 * The stylesheet reads them through `--font-open-sans` and `--font-roboto`,
 * which the root layout puts on `<html>`.
 */
export const openSans = localFont({
  src: [
    { path: './open-sans-var.woff2', weight: '300 800', style: 'normal' },
    { path: './open-sans-var-italic.woff2', weight: '300 800', style: 'italic' },
  ],
  variable: '--font-open-sans',
  display: 'swap',
  adjustFontFallback: 'Arial',
});

/** The navigation only, so not preloaded: it is a small file and never the largest text. */
export const roboto = localFont({
  src: './roboto-400.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-roboto',
  display: 'swap',
  adjustFontFallback: 'Arial',
  preload: false,
});
