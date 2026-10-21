import type { Metadata } from 'next';
import { LearnPageView } from '@/components/learn-page-view';
import { learnPage, learnPreview } from '@/lib/data';
import { learnPreviewMetadata } from '@/lib/learn-page-metadata';
import './preview-bar.css';

/**
 * `/learn/preview/<token>`: the Learn page's current draft, for the link the
 * dashboard's editor hands out (T316), so somebody without a dashboard login
 * can look at a draft before it goes live.
 *
 * Rendered per request and never cached (`force-dynamic`, plus `no-store` in
 * `next.config.ts`), so a rotated or revoked link stops working at once and a
 * draft never lands in a shared cache. A wrong or old token shows the
 * published page, as /learn would, with no hint that a draft exists. Either
 * way the page is noindex and sends no referrer.
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
  return (
    <>
      {draft && (
        <div className="learn-preview-bar" role="status">
          Preview, not published. This is the current draft; the public page may differ.
        </div>
      )}
      <LearnPageView content={page} remoteImages="optimize" />
    </>
  );
}
