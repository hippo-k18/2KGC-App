import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { eventAnalytics } from '@/lib/exports';
import { ROUTES } from '@/lib/nav';
import { Banner, PageHeader, Panel, ProgressBar, StatTiles } from '../../../ui';
import { APP_DISTRIBUTION, siteOrigin } from '../adoption-context';

export const dynamic = 'force-dynamic';

/**
 * Tools › App Adoption › App Adoption Email.
 *
 * Whova generates a templated email nagging attendees onto the app. Ours is the
 * same idea with the numbers filled in from real data, and one important
 * difference: it does not send.
 *
 * ── Why the copy, not the send button ───────────────────────────────────────
 *
 * `tickets/ticket-marketing/email-campaign` is Whova's attendee bulk-mail tool
 * and is deliberately unbuilt — a thousand attendees is a different problem
 * from forty-five speakers, needing batching, an unsubscribe register and
 * bounce handling, and getting it wrong is how a conference gets its sending
 * domain blocked. Message Speakers exists because forty-five is safe.
 *
 * So this hands over text to paste into whatever the organizer already mails
 * from. That is genuinely most of the value: the hard part of an adoption email
 * is knowing what to say and to whom, not the sending.
 */
export default async function AppAdoptionEmailPage() {
  await requireOrganizer();
  const a = await eventAnalytics();
  const origin = siteOrigin();
  const missing = a.ticketHolders - a.signedIn;

  const subject = 'Before KGC 2027: get the app';

  const body = `Hi there,

KGC 2027 is close, and the conference app is where your ticket actually lives.

It gives you:
  - your badge QR code, which is what gets scanned at the door
  - the full agenda, and a schedule you build yourself
  - who else is coming, and messages
  - session Q&A

${APP_DISTRIBUTION}

Your ticket is already waiting — sign in with the email address you bought it
with and it will find you.

Your ticket and claim code: ${origin}/tickets

See you at Cornell Tech,
The KGC team`;

  return (
    <>
      <PageHeader
        title="App Adoption Email"
        links={[
          <Link key="x" href={ROUTES.analyticsExports}>
            Analytics &amp; Exports
          </Link>,
          <Link key="a" href={ROUTES.attendees}>
            Attendees
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'App adoption', value: `${a.adoptionPct}%`, sub: `${a.signedIn} of ${a.ticketHolders}` },
          { label: 'Have not installed', value: missing, sub: 'the audience for this email' },
          { label: 'Ticket holders', value: a.ticketHolders, sub: 'total' },
        ]}
      />

      <Panel>
        <ProgressBar pct={a.adoptionPct} />
        <p className="muted" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
          Every one of the {missing} without the app has to be checked in by hand at the desk, and
          has no agenda in their pocket. That is the cost this email exists to reduce.
        </p>
      </Panel>

      <Banner kind="info">
        <strong>This does not send.</strong> Copy it into whatever you already mail attendees from.
        Bulk attendee email is Whova&rsquo;s Email Campaign and is unbuilt on purpose — a thousand
        recipients needs batching, an unsubscribe register and bounce handling, and getting that
        wrong is how a sending domain gets blocked. Speakers and sponsors <em>can</em> be mailed
        from here, because forty-five is a different problem.
      </Banner>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Subject</h2>
        <pre className="whova-code">{subject}</pre>

        <h2 className="section-header">Body</h2>
        <pre className="whova-code">{body}</pre>

        <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 10 }}>
          The install sentence comes from one constant shared with the public site. On the day the
          app is listed on a store, change it there and on the website — and not in a dozen pasted
          copies of this email, which is why it is written this way.
        </p>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Sending it, and sending only to the {missing} who need it.</strong> The segment
            exists — Attendees &rsaquo; Segments lists exactly those people, and Analytics &amp;
            Exports will give you them as a CSV.
          </li>
          <li>
            <strong>Open and click tracking.</strong> Adoption is measured here from who has a
            profile, which is the outcome rather than the proxy — and is the better number anyway.
          </li>
        </ul>
      </Panel>
    </>
  );
}
