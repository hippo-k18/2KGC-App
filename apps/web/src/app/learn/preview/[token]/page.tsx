import type { Metadata } from 'next';
import { LearnPageView } from '@/components/learn-page-view';
import { learnPage, learnPreview } from '@/lib/data';
import { learnPreviewMetadata, learnPreviewNotice } from '@/lib/learn-page-metadata';
import './preview-bar.css';

/**
 * `/learn/preview/<token>`: the Learn page's current draft, for the link the
 * dashboard's editor hands out (T316), so somebody without a dashboard login
 * can look at a draft before it goes live.
 *
 * Rendered per request and never cached (`force-dynamic`, plus `no-store` in
 * `next.config.ts`), so a rotated or revoked link stops working at once and a
 * draft never lands in a shared cache. A wrong or old token shows the
 * published page, as /learn would, under a note that the link no longer works
 * (T324 F13), the same for every wrong token, so it says nothing about whether
 * a draft or a link ever existed. Either way the page is noindex and sends no
 * referrer.
 *
 * The status stays 200 for a dead link: the page shown is the real public
 * page, and a 404 would make it look broken to someone who was simply sent an
 * old link. noindex keeps it out of search either way.
 */
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ token: string }> };

async function load(params: Props['params']) {
  const { token } = await params;
  const draft = await learnPreview(token);
  return { draft, page: draft ?? (await learnPage()) };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { page } = await load(params);
  return learnPreviewMetadata(page);
}

export default async function LearnPreviewPage({ params }: Props) {
  const { draft, page } = await load(params);
  const notice = learnPreviewNotice(draft !== null);
  return (
    <>
      <div className={notice.className} role="status">
        {notice.text}
      </div>
      <LearnPageView content={page} remoteImages="optimize" />
    </>
  );
}
