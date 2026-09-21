import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE } from '@/lib/site';

/**
 * The privacy notice, and the page the footer and the checkout consent line
 * both point at.
 *
 * ── Written to be true of this system, not to be generic ────────────────────
 *
 * Every list below was read out of the code rather than adapted from a
 * template. The collection list is the same walk the organizer dashboard runs
 * when somebody asks for a copy or a deletion (`person-data-core.ts`), so the
 * page and the button cannot drift into saying different things about what is
 * held. The four processors are the four this repository actually sends
 * personal data to. If a fifth is ever added, it belongs in the list here in
 * the same commit.
 *
 * ── The two placeholders, and why they are visible ──────────────────────────
 *
 * A privacy notice has to name the controller: the legal entity that decides
 * what happens to the data, and a postal address it can be written to. Neither
 * is in this repository and neither can be guessed. `/code-of-conduct` carries
 * "Knowledge Graphs Conference LLC", which is evidence and not confirmation,
 * and no address appears anywhere.
 *
 * So they are printed as bracketed placeholders with a line above them saying
 * so. The alternative was to invent a plausible entity name and address, which
 * would make this page a false legal statement that reads as a finished one.
 * A visible gap is fixed; an invented answer is not noticed.
 *
 * ⚠️ Fill both constants in and delete `MISSING_DETAILS` from the render. That
 * is the whole change.
 */

export const metadata: Metadata = {
  title: 'Privacy',
  description:
    'What the Knowledge Graph Conference collects about attendees, who processes it, and how to ask for a copy or a deletion.',
};

/** ⚠️ Placeholder. The registered company or association that runs the event. */
const LEGAL_ENTITY = '[Legal entity name]';

/** ⚠️ Placeholder. The postal address that entity can be written to. */
const POSTAL_ADDRESS = '[Registered postal address]';

/** True while either constant above is still a placeholder. */
const MISSING_DETAILS = LEGAL_ENTITY.startsWith('[') || POSTAL_ADDRESS.startsWith('[');

const COLLECTED = [
  {
    what: 'Your account',
    detail:
      'The email address you sign in with, your name, and anything you choose to put on your profile: job title, company, photo, interests and links.',
  },
  {
    what: 'Your registration',
    detail:
      'What you bought, the name and email on the ticket, and your answers to the registration questions, which can include dietary and accessibility needs.',
  },
  {
    what: 'Payment',
    detail:
      'The amount, the currency and a reference to the payment. Card numbers are entered on Stripe and never reach this site.',
  },
  {
    what: 'Check-in',
    detail: 'The time your badge was scanned at the door, and at any session desk that scans.',
  },
  {
    what: 'What you do in the app',
    detail:
      'Sessions you save, people you save, posts and replies on the community board, questions and votes in sessions, and messages you send to other attendees.',
  },
  {
    what: 'Survey answers',
    detail: 'Your answers to feedback surveys and polls, which are linked to your account.',
  },
  {
    what: 'Consent records',
    detail:
      'Which version of a release or consent form you signed, and when. This is the record that you agreed, so it is kept even after a deletion, with your name and address removed from it.',
  },
  {
    what: 'Email we send you',
    detail: 'A log of which messages were sent to your address, so a missing confirmation can be traced.',
  },
];

const PROCESSORS = [
  {
    name: 'Google Firebase',
    does: 'Stores the database, the files and the sign-in accounts, and delivers app notifications.',
  },
  { name: 'Stripe', does: 'Takes the payment and holds the card details. We never see them.' },
  { name: 'Resend', does: 'Sends the confirmation, reminder and announcement emails.' },
  { name: 'Netlify', does: 'Serves this website and the organizer tools.' },
];

export default function PrivacyPage() {
  return (
    <section>
      <div className="wrap narrow">
        <p className="eyebrow">Policy</p>
        <h1>Privacy</h1>
        <p className="lede">
          What the Knowledge Graph Conference collects about you, who else handles it, and how to
          get a copy of it or have it deleted.
        </p>

        <h2>Who is responsible</h2>
        {MISSING_DETAILS && (
          <p className="muted">
            The registered name and postal address are not filled in yet. Everything else on this
            page is accurate.
          </p>
        )}
        <p>
          {LEGAL_ENTITY}, {POSTAL_ADDRESS}. For anything about your data, write to{' '}
          <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>.
        </p>

        <h2>What we collect</h2>
        <p>
          Only what running the conference needs. There is no advertising network on this site, no
          third-party analytics script, and nothing about you is sold or shared for marketing.
        </p>
        <ul>
          {COLLECTED.map((c) => (
            <li key={c.what} style={{ padding: '6px 0' }}>
              <strong>{c.what}.</strong> {c.detail}
            </li>
          ))}
        </ul>

        <h2>Who else handles it</h2>
        <p>Four companies process data on our behalf. They may not use it for anything else.</p>
        <ul>
          {PROCESSORS.map((p) => (
            <li key={p.name} style={{ padding: '6px 0' }}>
              <strong>{p.name}.</strong> {p.does}
            </li>
          ))}
        </ul>

        <h2>What other people see</h2>
        <p>
          Your name, photo, title and company appear in the attendee directory in the app so other
          attendees can find you. You can turn that off at any time under Me, then Privacy, and you
          will stop appearing at once. Posts you write on the community board are visible to
          everyone at the event. Messages you send are visible only to the person you sent them to
          and to the organizers, who can read them when a code of conduct report is made.
        </p>

        <h2>Cookies</h2>
        <p>
          One first-party cookie keeps your checkout session together while you buy a ticket. The
          app and this site also keep a small amount of data in your browser to remember that you
          are signed in and what you have dismissed. There are no advertising or tracking cookies.
        </p>

        <h2>How long we keep it</h2>
        <p>
          Your account and profile stay until you ask for them to be deleted. Records of payments
          are kept for as long as tax and accounting rules require, with your name removed once you
          ask. Signed consent and release forms are kept as the record that you agreed, with your
          name and address removed.
        </p>

        <h2>Getting a copy, or having it deleted</h2>
        <p>
          Write to <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a> and say which you
          want. A copy comes back as a single file holding everything listed above. A deletion
          removes your ticket, your profile, your check-ins, your messages, your posts and your
          survey answers. What survives is described above: the payment record and the signed
          consent forms, with your name taken off both. After a deletion you can no longer sign into
          the app.
        </p>
        <p>
          You can also correct anything wrong, object to how we use it, or ask us to stop emailing
          you. Every email we send has an unsubscribe link, and using it stops the mailing list
          without touching your ticket.
        </p>
        <p>
          If you are not happy with how we have handled a request, you can complain to your national
          data protection authority.
        </p>

        <p className="muted" style={{ marginTop: 40 }}>
          See also the <Link href="/code-of-conduct">code of conduct</Link>. General enquiries:{' '}
          <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>.
        </p>
      </div>
    </section>
  );
}
