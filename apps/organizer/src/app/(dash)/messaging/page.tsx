import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { DESK_NAME, deskRecipients, listDeskThreads } from '@/lib/messaging';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, PageHeader, Panel, Table, Tag } from '../ui';
import { DeskComposer } from './desk-composer';

export const dynamic = 'force-dynamic';

/**
 * The conference desk's inbox — the organizer's half of `threads`.
 *
 * Audit E (B7) found `threads` appearing zero times in this dashboard while the
 * attendee app shipped a full inbox with an unread badge. This closes the half
 * of that gap that should be closed, and states the other half rather than
 * quietly leaving it: **attendee-to-attendee messages are not readable here, on
 * purpose.** The whole argument lives in `lib/messaging.ts`; the short version
 * is that running on the Admin SDK means this dashboard *could* read every
 * private conversation in the event, and that capability is not a licence.
 *
 * ── Not in Whova's navigation tree ──────────────────────────────────────────
 *
 * `lib/nav.ts` is transcribed from Whova's own shipped bundle and Whova has no
 * organizer inbox — their organizers send announcements and bulk email, which
 * is exactly the gap audit E identified. So this route has no nav node yet and
 * is reached from the link row on Message Speakers and Message Sponsors, both of
 * which are in the tree. Adding `ROUTES.deskMessages` and an `IMPLEMENTED`
 * entry is a two-line follow-up.
 */
export default async function DeskInboxPage() {
  await requireOrganizer();

  const [threads, { recipients, notSignedIn, messagingOff }] = await Promise.all([
    listDeskThreads(),
    deskRecipients(),
  ]);

  const waiting = threads.filter((t) => t.unread > 0).length;

  return (
    <>
      <PageHeader
        title="Direct Messages"
        tags={
          waiting > 0 ? (
            <Tag color="orange" fill="solid">
              {waiting} waiting
            </Tag>
          ) : null
        }
        links={[
          <Link key="sp" href={ROUTES.messageSpeakers}>
            Message Speakers
          </Link>,
          <Link key="so" href={ROUTES.messageSponsors}>
            Message Sponsors
          </Link>,
          <Link key="at" href={ROUTES.attendees}>
            Attendees
          </Link>,
        ]}
      />

      <Banner kind="info">
        Messages here are sent and received as <strong>{DESK_NAME}</strong>, a single shared
        identity — every organizer writes as the desk and an attendee replies to the desk, the way a
        support address works. There is no per-organizer account to send from; the audit log records
        which of you sent what.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Conversations ({threads.length})</h2>
        <Table
          cols={[
            { key: 'who', label: 'With', className: 'cell-md' },
            { key: 'last', label: 'Last message', className: 'cell-fill' },
            { key: 'when', label: 'When', className: 'cell-sm' },
            { key: 'state', label: '', className: 'cell-sm' },
          ]}
          rows={threads.map((t) => [
            <Link key="w" href={`/messaging/${t.threadId}`}>
              {t.correspondentName}
            </Link>,
            <span key="l" style={{ fontSize: 13 }} className={t.lastMessage ? undefined : 'muted'}>
              {t.lastMessage ?? 'Nothing said yet'}
            </span>,
            <span key="t" className="muted" style={{ fontSize: 12 }}>
              {t.lastMessageAt ? (
                <>
                  {t.lastMessageAt.slice(0, 10)}
                  <br />
                  {t.lastMessageAt.slice(11, 16)}
                </>
              ) : (
                '—'
              )}
            </span>,
            <span key="s">
              {t.unread > 0 ? (
                <Tag color="orange" fill="solid" small>
                  {t.unread} unread
                </Tag>
              ) : t.lastSenderWasDesk ? (
                <Tag color="grey" fill="outline" small>
                  awaiting reply
                </Tag>
              ) : null}
            </span>,
          ])}
          empty="Nobody has messaged the desk and the desk has messaged nobody. Start a conversation below — it arrives in their app inbox, not their email."
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Start a conversation</h2>
        <DeskComposer recipients={recipients} />

        {/*
          The excluded counts are printed for the same reason `resolveAudience`
          prints `withoutEmail`: a picker that silently omits people reads as a
          complete list, and the organizer discovers otherwise while looking for
          somebody who is not in it.
        */}
        <p className="muted" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
          <strong>{recipients.length}</strong> people can be reached this way.{' '}
          {notSignedIn > 0 && (
            <>
              <strong>{notSignedIn}</strong> hold a ticket but have never opened the app, so they
              have no inbox — email is the only way to reach them.{' '}
            </>
          )}
          {messagingOff > 0 && (
            <>
              <strong>{messagingOff}</strong> have turned direct messages off on their own profile
              and are deliberately not listed.
            </>
          )}
        </p>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here — and one of them on purpose</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Attendee-to-attendee messages are not readable here, and that is a decision
            rather than a gap.</strong> This dashboard runs on the Admin SDK and bypasses{' '}
            <code>firestore.rules</code>, so it could list every thread in the event. Nothing in the
            product asks anyone&rsquo;s permission for that: no attendee-facing copy says an
            organizer can read direct messages, and the rules deny every non-participant precisely
            so the answer is nobody. A screen rendering a thousand private conversations would make
            all of that quietly false.
          </li>
          <li>
            <strong>Moderation would need a different mechanism, not a wider query.</strong> The
            honest shape is an attendee-initiated <em>report</em> on a specific message, so a
            moderator sees only what somebody chose to escalate. There is no such document in{' '}
            <code>models.ts</code> and adding one is a decision, not a detail.
          </li>
          <li>
            <strong>One desk, not one organizer.</strong> Dashboard sign-in is an email allowlist
            plus a shared passphrase and there is <em>no per-organizer Firebase uid</em>, so there
            is no authenticated person to put in <code>participantIds</code>. Inventing one per
            organizer would fabricate an identity the authentication cannot back. Accountability is
            the audit entry on each send instead.
          </li>
          <li>
            <strong>No push, so no notification.</strong> Nothing writes <code>fcmTokens</code> and
            push needs a development build. A message waits until the attendee next opens the app,
            which is why the composer says so.
          </li>
          <li>
            <strong>No attachments and no read receipt.</strong> Nothing in this project uploads a
            file, and the app never records that a message was seen — only the unread counter moves.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
