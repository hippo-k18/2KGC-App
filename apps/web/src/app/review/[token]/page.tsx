import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SITE } from '@/lib/site';
import { queueFor, reviewerFor } from '@/lib/reviews';

export const metadata: Metadata = {
  // A capability URL, like `/submit/token/{token}`: kept out of indexes and caches.
  title: 'Your reviews',
  robots: { index: false, follow: false, nocache: true, noarchive: true },
};

/** Per-request, and it has to be. Reads a capability token. One reviewer's queue must never be served to another from a cache. */
export const dynamic = 'force-dynamic';

/**
 * `/review/{token}` — one reviewer's list of submissions to score.
 *
 * ── What holding this URL lets you do ──────────────────────────────────────
 *
 * Read the submissions assigned to one reviewer and write that reviewer's own
 * review of each. `scripts/src/lib/reviewer-token.ts` carries the argument and
 * the threat it accepts. The token names a reviewer and never a submission:
 * which submissions are theirs is read from Firestore on every request, so a
 * conflict of interest or a removal from the committee takes effect on a link
 * that was mailed weeks ago.
 *
 * A bad token, an expired one and a reviewer who has been removed all get the
 * same 404.
 */
export default async function ReviewQueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ r?: string }>;
}) {
  const { token: raw } = await params;
  const { r } = await searchParams;
  const token = decodeURIComponent(raw);

  const reviewer = await reviewerFor(token);
  if (!reviewer) notFound();

  const { items, trackName } = await queueFor(reviewer);
  const open = items.filter((i) => i.reviewStatus === 'assigned' && !i.closed);
  const done = items.filter((i) => i.reviewStatus === 'submitted');
  const rest = items.filter((i) => !open.includes(i) && !done.includes(i));
  const href = (id: string) => `/review/${encodeURIComponent(token)}/${encodeURIComponent(id)}`;

  return (
    <section>
      <div className="wrap narrow" style={{ paddingBottom: 48 }}>
        <p className="eyebrow">
          {SITE.shortName} {SITE.year} programme committee
        </p>
        <h1>Your reviews</h1>
        <p className="lede">
          {reviewer.name ? `${reviewer.name}, thank you for reviewing. ` : 'Thank you for reviewing. '}
          {open.length === 0
            ? done.length > 0
              ? 'You have reviewed everything assigned to you.'
              : 'Nothing has been assigned to you yet.'
            : `${open.length} submission${open.length === 1 ? ' is' : 's are'} waiting for your scores.`}
        </p>

        {r === 'conflict' && (
          <p className="notice" role="status">
            <strong>Conflict recorded.</strong> That submission is off your list and the organizers
            have been shown why.
          </p>
        )}
        {r === 'error' && (
          <p className="notice bad" role="alert">
            <strong>That did not work, and nothing has changed.</strong> Email{' '}
            <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>.
          </p>
        )}

        {open.length > 0 && (
          <>
            <h2>To review</h2>
            <QueueList items={open} href={href} trackName={trackName} />
          </>
        )}

        {done.length > 0 && (
          <>
            <h2>Reviewed</h2>
            <QueueList items={done} href={href} trackName={trackName} />
          </>
        )}

        {rest.length > 0 && (
          <>
            <h2>No longer on your list</h2>
            <ul style={{ paddingLeft: 18 }}>
              {rest.map((i) => (
                <li key={i.submissionId} className="muted">
                  {i.conflict ? 'Conflict of interest declared' : `${i.title || 'Untitled'}. ${i.closed}`}
                </li>
              ))}
            </ul>
          </>
        )}

        <p className="muted" style={{ marginTop: 32 }}>
          Keep this link and do not forward it. Anybody who has it can read these submissions and
          score them in your name.
        </p>
        <p className="muted">
          <Link href="/">
            Back to {SITE.shortName} {SITE.year}
          </Link>
        </p>
      </div>
    </section>
  );
}

function QueueList({
  items,
  href,
  trackName,
}: {
  items: Awaited<ReturnType<typeof queueFor>>['items'];
  href: (id: string) => string;
  trackName: Map<string, string>;
}) {
  return (
    <div className="checkout" style={{ display: 'grid', gap: 14 }}>
      {items.map((i) => (
        <div key={i.submissionId}>
          <Link href={href(i.submissionId)} style={{ fontWeight: 600 }}>
            {i.title || 'Untitled'}
          </Link>
          <p className="hint" style={{ margin: '2px 0 0' }}>
            {[
              i.callTitle,
              i.trackId ? (trackName.get(i.trackId) ?? undefined) : undefined,
              i.reviewStatus === 'submitted'
                ? `your overall ${i.overall?.toFixed(1) ?? ''} of 10${i.closed ? '' : ', can still be changed'}`
                : i.started
                  ? 'draft saved, not submitted'
                  : 'not started',
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      ))}
    </div>
  );
}
