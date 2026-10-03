import 'server-only';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The article bodies and author boxes that `scripts/scrape-blog.py` pulled off
 * the live WordPress.
 *
 * Kept apart from `posts.ts` because they are read from disk: `posts.ts` is
 * imported by the index and the search page, and neither should carry 600 KB of
 * article HTML into its bundle to render a card.
 *
 * The HTML is rendered with `dangerouslySetInnerHTML`, which AGENTS.md rules out
 * for the organizer's `pages`. The difference is where the markup comes from.
 * `pages` is typed into a live editor by whoever holds the dashboard passphrase;
 * these files are checked into the repo, were cut down by the scraper to an
 * allowlist of plain document tags (no `script`, no `style`, no event handlers,
 * no attributes beyond `href`/`src`/`alt` and sizing), and change only when
 * somebody re-runs the scrape and commits the diff.
 */

const DIR = join(process.cwd(), 'src', 'content', 'blog');

export type Author = { avatar: string | null; bio: string };

let authors: Record<string, Author> | null = null;

/** The cleaned article body, or `null` when the scrape has not been run for it. */
export function getPostBody(slug: string): string | null {
  // `slug` only ever comes from `generateStaticParams`, but a path built from a
  // URL segment is worth one check that it cannot leave the directory.
  if (!/^[a-z0-9-]+$/i.test(slug)) return null;
  try {
    return readFileSync(join(DIR, `${slug}.html`), 'utf8');
  } catch {
    return null;
  }
}

export function getAuthor(name: string): Author | null {
  if (!authors) {
    try {
      authors = JSON.parse(readFileSync(join(DIR, 'authors.json'), 'utf8'));
    } catch {
      authors = {};
    }
  }
  return authors?.[name] ?? null;
}
