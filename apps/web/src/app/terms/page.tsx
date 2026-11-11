import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { RichBlocks } from '@/components/rich-text';
import { termsPublished } from '@/lib/terms-core';
import { readTerms } from '@/lib/terms';

/**
 * The conference terms, from `src/content/terms-2027.md`.
 *
 * A 404 until `TERMS_PUBLISHED=true` (see `lib/terms-core.ts`): the wording is
 * legal text awaiting approval, and a page that exists can be found, quoted or
 * cached even with nothing linking to it. Dynamic so the 404 and the page both
 * follow the server's own setting rather than whatever the build saw.
 *
 * Headings carry anchors from the file (`{#refunds}`, `{#transfers}`,
 * `{#cancellations}`), which checkout and the /tickets FAQ link to.
 * Indexing follows the rest of the site: the middleware's `X-Robots-Tag`
 * keeps it out of search until `SITE_INDEXABLE=true`.
 */
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  if (!termsPublished()) return {};
  return {
    title: 'Terms and conditions',
    description: 'The terms that apply to tickets for the Knowledge Graph Conference: refunds, transfers, cancellations and conduct at the event.',
  };
}

export default function TermsPage() {
  if (!termsPublished()) notFound();
  const terms = readTerms();
  return (
    <section>
      <div className="wrap narrow terms-body">
        <h1>{terms.title}</h1>
        <RichBlocks blocks={terms.blocks} headingIds={terms.headingIds} />
      </div>
    </section>
  );
}
