import localFont from 'next/font/local';

/**
 * The website's Open Sans, same files and settings as `apps/web/src/fonts`,
 * so text in the preview wraps where it wraps on the site. Put this class on
 * the preview frame; `site-base.css` reads `--font-open-sans`.
 */
const openSans = localFont({
  src: [
    { path: './fonts/open-sans-var.woff2', weight: '300 800', style: 'normal' },
    { path: './fonts/open-sans-var-italic.woff2', weight: '300 800', style: 'italic' },
  ],
  variable: '--font-open-sans',
  display: 'swap',
  adjustFontFallback: 'Arial',
});

export const previewFontClass = openSans.variable;
