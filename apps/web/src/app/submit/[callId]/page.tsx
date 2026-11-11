import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatDeadline, SITE } from '@/lib/site';
import { loadCall } from '@/lib/submissions';
import { SubmissionForm } from '../submission-form';
import { CallText } from '@/components/call-text';

/** Per-request, and it has to be. Whether a call is still open, against a deadline that can pass while somebody is on the page. */
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
type Block = { kind: 'text'; text: string } | { kind: 'list'; items: string[] };

/**
 * The call's text as paragraphs and lists. Paragraphs are separated by a blank
 * line, and a run of lines starting "- " (or "• ", "* ") is a bulleted list
 * rather than literal hyphens (T261 #3). Plain text only, never markup.
 */
function instructionBlocks(text: string): Block[] {
  const out: Block[] = [];
  for (const para of text.split(/\n\s*\n/)) {
    let lines: string[] = [];
    let items: string[] = [];
    const flushText = () => {
      const t = lines.join('\n').trim();
      if (t) out.push({ kind: 'text', text: t });
      lines = [];
    };
    const flushList = () => {
      if (items.length) out.push({ kind: 'list', items });
      items = [];
    };
    for (const line of para.split('\n')) {
      const bullet = /^\s*[-•*]\s+(.*\S)\s*$/.exec(line);
      if (bullet) {
        flushText();
        items.push(bullet[1]);
      } else {
        flushList();
        lines.push(line);
      }
    }
    flushText();
    flushList();
  }
  return out;
}

export default async function SubmitPage({ params }: { params: Promise<{ callId: string }> }) {
  const { callId } = await params;
  const call = await loadCall(callId);
  if (!call) notFound();

  return (
    <section>
      <div className="wrap narrow cfp-page" style={{ paddingBottom: 48 }}>
        <p className="eyebrow">
          {SITE.shortName} {SITE.year}
        </p>
        <h1>{call.title}</h1>

        {/*
          Formatted text from the dashboard's editor when there is some (T277),
          otherwise the plain text exactly as it has always been drawn.
        */}
        {call.instructionsDoc ? (
          <CallText doc={call.instructionsDoc} />
        ) : (
          instructionBlocks(call.instructions).map((block, i) =>
            block.kind === 'list' ? (
              <ul key={i}>
                {block.items.map((item, j) => (
                  <li key={j}>{item}</li>
                ))}
              </ul>
            ) : (
              <p key={i} className={i === 0 ? 'lede' : undefined} style={{ whiteSpace: 'pre-wrap' }}>
                {block.text}
              </p>
            ),
          )
        )}

        {call.opensOn ? (
          /*
           * Early is not an error (T261 #3). Someone arriving before the call
           * opens gets the date, not a red refusal and an address to complain to.
           */
          <p className="notice" role="status">
            <strong>Opens {call.opensOn}.</strong>
          </p>
        ) : call.refusal ? (
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
              Submissions cannot be saved right now, so the form is hidden. If you think this is a
              mistake, email{' '}
              <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>.
            </p>
          </>
        ) : (
          <>
            <p className="notice">
              {call.cfp ? (
                /*
                 * Min's settings carry the close date (T249). While it is not
                 * decided the sentence is left out, rather than showing the
                 * placeholder deadline the call was created with.
                 */
                call.cfp.closeDay ? (
                  <>
                    Submissions close on <strong>{call.cfp.closeDay}</strong>.{' '}
                  </>
                ) : null
              ) : (
                <>
                  Submissions close on{' '}
                  <strong>{formatDeadline(call.closesAtLocal, call.timeZone) ?? call.closesAtLocal}</strong>
                  .{' '}
                </>
              )}
              No account needed. We will email you a link back to your submission.
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
