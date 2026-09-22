import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatDeadline, SITE } from '@/lib/site';
import { loadCall } from '@/lib/submissions';
import { SubmissionForm } from '../submission-form';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ callId: string }>;
}): Promise<Metadata> {
  const { callId } = await params;
  const call = await loadCall(callId);
  return {
    title: call ? `${call.title} · ${SITE.shortName} ${SITE.year}` : 'Call for abstracts',
    description: call?.instructions.slice(0, 160),
  };
}

/**
 * `/submit/{callId}` — the public call for abstracts.
 *
 * ── The audience has no account and must not need one ──────────────────────
 *
 * `isRegistered()` — the `registered` custom claim — gates everything in
 * `firestore.rules`, and it is minted only for ticket holders. Most people who
 * submit an abstract will never buy a ticket and a meaningful number will never
 * attend, so a portal that required one would not be a call for papers. There is
 * therefore no sign-in here, no password, and no Firebase Auth user: the write
 * goes through a server action on the Admin SDK, and the author comes back
 * through an HMAC capability link — the scheme `/order/{token}` and
 * `/consent/{token}` already prove.
 *
 * ── The deadline is refused by the server, and this page says so ───────────
 *
 * A closed call renders the reason instead of the form, but that is a courtesy
 * and not the enforcement: `saveSubmission` re-reads the call and refuses the
 * write. `CFA-PLAN.md` §4 — the page and the POST are separate requests, and a
 * form left open across the deadline posts from a page that was honest when it
 * rendered.
 *
 * ── A draft call 404s ──────────────────────────────────────────────────────
 *
 * Along with a call for another event and a call that does not exist, and
 * deliberately without distinguishing them. Two of the three would otherwise
 * answer "is KGC running a call this year?" to anybody who guessed a URL, which
 * is a question the committee may not have announced the answer to yet.
 */
export default async function SubmitPage({ params }: { params: Promise<{ callId: string }> }) {
  const { callId } = await params;
  const call = await loadCall(callId);
  if (!call) notFound();

  return (
    <section>
      <div className="wrap narrow" style={{ paddingBottom: 48 }}>
        <p className="eyebrow">
          {SITE.shortName} {SITE.year}
        </p>
        <h1>{call.title}</h1>

        {call.instructions
          .split(/\n\s*\n/)
          .map((para) => para.trim())
          .filter(Boolean)
          .map((para, i) => (
            <p key={i} className={i === 0 ? 'lede' : undefined} style={{ whiteSpace: 'pre-wrap' }}>
              {para}
            </p>
          ))}

        {call.refusal ? (
          <>
            <p className="notice warn" role="status">
              <strong>{call.refusal}</strong>
            </p>
            <p className="muted">
              {/*
                No form at all rather than a disabled one. A greyed-out form is a
                promise the server will not keep, and somebody will spend twenty
                minutes filling it in before finding out.
              */}
              The submission form is not shown because nothing typed into it could be saved. If you
              believe this is a mistake, email{' '}
              <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>.
            </p>
          </>
        ) : (
          <>
            <p className="notice">
              Submissions close on{' '}
              <strong>{formatDeadline(call.closesAtLocal, call.timeZone) ?? call.closesAtLocal}</strong>
              . You do not need an account: fill this in, and we will email you a link that brings
              you back to it.
            </p>
            <SubmissionForm call={call} />
          </>
        )}

        <p className="muted" style={{ marginTop: 32 }}>
          <Link href="/">
            Back to {SITE.shortName} {SITE.year}
          </Link>
        </p>
      </div>
    </section>
  );
}
