import 'server-only';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTerms, type TermsDocument } from './terms-parse';

/**
 * The terms text, from one file: `src/content/terms-2027.md`. Approving new
 * wording is replacing that file; no code changes. Read the same way the blog
 * archive reads its bodies (`post-content.ts`), relative to the app's own
 * directory, which is where `next start` runs.
 */
export const TERMS_FILE = join(process.cwd(), 'src', 'content', 'terms-2027.md');

export function readTerms(): TermsDocument {
  return parseTerms(readFileSync(TERMS_FILE, 'utf8'));
}
