import { notFound } from 'next/navigation';
import {
  expandReusableBlocks,
  LEARN_LIBRARY_SAMPLE,
  LEARN_PAGE_KITCHEN_SINK_V2,
  parseLearnPageContent,
  parseLearnSection,
} from '@kgc/shared';
import { previewFontClass } from '../../(dash)/content/learn-page/preview-blocks';
import { LearnPageView } from './page-view';

/**
 * Development only: the v2 kitchen-sink page drawn with the dashboard's
 * preview twins (T319), for pixel-diffing against the website's /learn.
 *
 * `page-view.tsx`, its CSS and `linkedin-icon.tsx` are copies of the
 * website's, so the only thing this page measures is whether the twins and
 * their CSS draw the same inside the dashboard (its fonts, its global CSS,
 * its `next/image`). Not linked from anywhere; a production build answers 404
 * unless `KGC_DEV_PAGES=1`.
 *
 * `?site=` is the website origin for `/kgc/...` assets.
 */
export default async function LearnTwinsHarness({ searchParams }: { searchParams: Promise<{ site?: string }> }) {
  if (process.env.NODE_ENV === 'production' && process.env.KGC_DEV_PAGES !== '1') notFound();
  const { site } = await searchParams;
  const origin = site && /^https?:\/\/[\w.:-]+$/.test(site) ? site : 'https://www.knowledgegraph.tech';
  const page = parseLearnPageContent(LEARN_PAGE_KITCHEN_SINK_V2)!;
  const library = new Map(Object.entries(LEARN_LIBRARY_SAMPLE).map(([id, s]) => [id, parseLearnSection(s)]));
  return (
    <div className={`lp-site-base ${previewFontClass}`}>
      <LearnPageView content={expandReusableBlocks(page, library)} assetOrigin={origin} />
    </div>
  );
}
