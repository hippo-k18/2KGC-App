import type { Metadata } from 'next';
import { LearnPageView } from '@/components/learn-page-view';
import { learnPage } from '@/lib/data';
import { learnPageMetadata } from '@/lib/learn-page-metadata';

/**
 * KGC | Learn, drawn from `pageLayouts/learn` `published` (the dashboard's page
 * editor), or from `LEARN_PAGE_DEFAULT` until something is published.
 *
 * The default is the hand-built page this route used to be: a close copy of
 * the live knowledge-graph-learning-program page, measured on 2026-08-19 at a
 * 1600px viewport. Its measurements now live in `learn-page-view.css`, and
 * T311 pixel-diffed the two renderings at 1600, 1280 and 390.
 *
 * The current draft is shown at `/learn/preview/<token>` (T316), never here, so
 * this page stays static.
 */

/** Re-read every 30 seconds, so a publish reaches this page within a minute. */
export const revalidate = 30;

export async function generateMetadata(): Promise<Metadata> {
  return learnPageMetadata(await learnPage());
}

export default async function LearnPage() {
  return <LearnPageView content={await learnPage()} remoteImages="optimize" />;
}
