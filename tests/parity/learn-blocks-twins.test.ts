import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The Learn page's v2 blocks are drawn by the website (`apps/web/src/
 * components/learn-blocks/`) and by the dashboard preview (`apps/organizer/
 * .../learn-page/preview-blocks/`), and the apps cannot import each other
 * (T319). A preview that is "nearly" the page is how an editor starts lying,
 * so the two folders hold the same files byte for byte. When this fails, edit
 * the website copy and copy it over.
 */

const root = join(import.meta.dirname, '..', '..');
const web = join(root, 'apps/web/src/components/learn-blocks');
const dash = join(root, 'apps/organizer/src/app/(dash)/content/learn-page/preview-blocks');
const harness = join(root, 'apps/organizer/src/app/dev/learn-twins');

/** Files only the dashboard has: its index, font and the site's base rules. */
const DASHBOARD_ONLY = new Set(['index.ts', 'preview-font.ts', 'site-base.css', 'fonts']);

describe('Learn page block twins', () => {
  const webFiles = readdirSync(web).sort();

  it('the dashboard has every website file and nothing else of its own', () => {
    const dashFiles = readdirSync(dash).filter((f) => !DASHBOARD_ONLY.has(f)).sort();
    expect(dashFiles).toEqual(webFiles);
  });

  for (const f of webFiles) {
    it(`${f} is identical in both apps`, () => {
      expect(readFileSync(join(dash, f), 'utf8')).toBe(readFileSync(join(web, f), 'utf8'));
    });
  }

  it("the twin harness draws with copies of the website's page view", () => {
    const webView = readFileSync(join(root, 'apps/web/src/components/learn-page-view.tsx'), 'utf8').replaceAll(
      "'./learn-blocks/",
      "'../../(dash)/content/learn-page/preview-blocks/",
    );
    expect(readFileSync(join(harness, 'page-view.tsx'), 'utf8')).toBe(webView);
    expect(readFileSync(join(harness, 'learn-page-view.css'), 'utf8')).toBe(
      readFileSync(join(root, 'apps/web/src/components/learn-page-view.css'), 'utf8'),
    );
    expect(readFileSync(join(harness, 'linkedin-icon.tsx'), 'utf8')).toBe(
      readFileSync(join(root, 'apps/web/src/components/linkedin-icon.tsx'), 'utf8'),
    );
  });

  it('the dashboard font is the website font', () => {
    for (const f of ['open-sans-var.woff2', 'open-sans-var-italic.woff2']) {
      expect(readFileSync(join(dash, 'fonts', f)).equals(readFileSync(join(root, 'apps/web/src/fonts', f)))).toBe(true);
    }
  });
});
