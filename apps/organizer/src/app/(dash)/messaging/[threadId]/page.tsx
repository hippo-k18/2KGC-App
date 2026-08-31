import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOrganizer } from '@/lib/auth';
import { DESK_NAME, deskThread } from '@/lib/messaging';
import { Banner, PageHeader, Panel, Tag } from '../../ui';
import { markDeskThreadReadAction } from '../actions';
import { DeskComposer } from '../desk-composer';

export const dynamic = 'force-dynamic';

/**
 * One conversation between the desk and one attendee.
 *
 * ── Why a `notFound()` and not an error ─────────────────────────────────────
 *
 * `deskThread()` returns null for two different situations and this page
 * deliberately renders the same thing for both: the thread does not exist, and
 * the thread exists but the desk is not in it. Distinguishing them would turn
 * this URL into an oracle for whether two named attendees have ever spoken —
 * which is exactly the disclosure the read scoping in `lib/messaging.ts` exists
 * to prevent, leaking through the error page instead of the query.
 *
 * ── The thread id is never parsed ───────────────────────────────────────────
 *
 * It arrives from the URL and goes straight to `deskThread()`, which resolves
 * the correspondent from `participantIds` on the document. Nothing splits it.
 * The uids either side of the separator can themselves contain the separator —
 * `demo_000` and `demo_001` are the demo accounts — and taking one apart is the
 * worst bug this repo has had.
 */
export default async function DeskThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  await requireOrganizer();

  const { threadId } = await params;
  const thread = await deskThread(threadId);
  if (!thread) notFound();

  return (
    <>
      <PageHeader
        title={thread.correspondentName}
        tags={
          thread.unread > 0 ? (
            <Tag color="orange" fill="solid">
              {thread.unread} unread
            </Tag>
          ) : null
        }
        links={[
          <Link key="i" href="/messaging">
            All conversations
          </Link>,
        ]}
      />

      {thread.correspondentDetail && (
        <Banner kind="info">{thread.correspondentDetail}</Banner>
      )}

      <Panel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {thread.messages.length === 0 && (
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              This conversation has a thread document but no messages in it — somebody opened it
              from the app and never wrote anything.
            </p>
          )}
          {thread.messages.map((m) => (
            /*
             * Sent-by-us on the right, them on the left, which is the one
             * convention every messaging surface shares. `fromDesk` is compared
             * against `senderId`, not inferred from position in the thread.
             */
            <div
              key={m.id}
              style={{
                alignSelf: m.fromDesk ? 'flex-end' : 'flex-start',
                background: m.fromDesk ? 'var(--surface-alt)' : 'transparent',
                border: '1px solid var(--hairline)',
                borderRadius: 6,
                maxWidth: '78%',
                padding: '9px 12px',
              }}
            >
              <div
                className="muted"
                style={{ fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase' }}
              >
                {m.fromDesk ? DESK_NAME : thread.correspondentName}
                {m.sentAt ? ` · ${m.sentAt.slice(0, 10)} ${m.sentAt.slice(11, 16)}` : ''}
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{m.body}</div>
            </div>
          ))}
        </div>
      </Panel>

      {thread.unread > 0 && (
        <Panel style={{ marginTop: 16 }}>
          {/*
            An explicit button rather than clearing the badge on render. A server
            component may not mutate while rendering, and beyond that a counter
            that zeroes itself the moment a page loads is a counter that loses
            the "somebody still has to deal with this" signal on a stray click.
          */}
          <form action={markDeskThreadReadAction.bind(null, threadId)}>
            <button type="submit" className="whova-btn-main secondary">
              Mark as read
            </button>
            <span className="muted" style={{ fontSize: 12, marginLeft: 10 }}>
              Clears the desk&rsquo;s own counter. Their side is untouched.
            </span>
          </form>
        </Panel>
      )}

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Reply</h2>
        <DeskComposer
          fixedRecipient={{ uid: thread.correspondentUid, name: thread.correspondentName }}
        />
      </Panel>
    </>
  );
}
