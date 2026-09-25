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
 * ── The two details that are not published yet ──────────────────────────────
 *
 * A privacy notice has to name the controller: the legal entity that decides
 * what happens to the data, and a postal address it can be written to. Neither
 * is in this repository and neither can be guessed. `/code-of-conduct` carries
 * "Knowledge Graphs Conference LLC", which is evidence and not confirmation,
 * and no address appears anywhere.
 *
 * Inventing a plausible entity and address was never an option — it would make
 * this a false legal statement that reads as a finished one. Nor is printing
 * `[Legal entity name], [Registered postal address]`, which is what this page
 * did until now: a public legal page with fill-in-the-blank markers on it reads
 * as unfinished software rather than as a missing fact, and a reader cannot
 * tell whether anything else on the page is real.
 *
 * So the page names the route that works today, in one sentence at the end of
 * the paragraph that already gives the address, and prints no markers. It does
 * not announce that the two details are missing: a notice that says what it is
 * not telling you, and then adds that everything else on it is accurate, gives
 * a reader a reason to doubt the rest. The sentence disappears on its own the
 * moment both constants hold real values.
 *
 * ⚠️ Fill both constants in. Nothing else has to change.
 */

export const metadata: Metadata = {
  title: 'Privacy',
  description:
    'What the Knowledge Graph Conference collects about attendees, who processes it, and how to ask for a copy or a deletion.',
};

/** ⚠️ Not filled in. The registered company or association that runs the event. */
const LEGAL_ENTITY = '';

/** ⚠️ Not filled in. The postal address that entity can be written to. */
const POSTAL_ADDRESS = '';

/** True while either detail above is still missing. Nothing is printed for it. */
const MISSING_DETAILS = !LEGAL_ENTITY.trim() || !POSTAL_ADDRESS.trim();

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
        <h1>Privacy</h1>
        <p className="lede">
          What the Knowledge Graph Conference collects about you, who else handles it, and how to
          get a copy of it or have it deleted.
        </p>

        <h2>Who is responsible</h2>
        {MISSING_DETAILS ? (
          <p>
            The Knowledge Graph Conference decides what happens to the data described on this page.
            For anything about your data, write to{' '}
            <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a> and you will reach the
            people who can answer. Ask at the same address for the registered company name and
            postal address.
          </p>
        ) : (
          <p>
            {LEGAL_ENTITY}, {POSTAL_ADDRESS}. For anything about your data, write to{' '}
            <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>.
          </p>
        )}

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
          name and address removed. If you asked us to stop emailing you, we keep a note that you
          asked, with nothing else on it, because that is the only way to be sure a later import
          cannot put you back on the list.
        </p>

        <h2>Getting a copy, or having it deleted</h2>
        <p>
          Write to <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a> and say which you
          want. A copy comes back as a single file holding everything listed above. A deletion
          removes your ticket, your profile, your check-ins, your messages, your posts and your
          survey answers. After a deletion you can no longer sign into the app.
        </p>
        <p>
          Four things survive a deletion, each with your name and address taken off it: the payment
          record, the signed consent forms, the note that you are not to be emailed, and our own log
          of what the organizers did. If you spoke at the conference, your talk stays on the
          published programme, because the programme is the record of what happened. Write to us if
          you want to talk about that one.
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
