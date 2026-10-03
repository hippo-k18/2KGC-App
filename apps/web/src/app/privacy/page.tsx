import type { Metadata } from 'next';
import Link from 'next/link';
import { consentNoticeOn } from '@/lib/analytics';
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

/**
 * Whether the site is loading Google Analytics, Google Tag Manager and, through
 * Tag Manager, Apollo.io. The same switch the layout reads (`ANALYTICS_ENABLED`,
 * off on staging, turned on at the www cutover; see the launch-readiness
 * branch's `lib/analytics.ts`). While it is off, the page says nothing about
 * them, because nothing loads them. Read at render, not at import: the layout's
 * `revalidate` re-renders this page against the server's own environment.
 *
 * ⚠️ Legal copy added 2026-09-29 (T054) for review before launch: the attribution
 * cookies paragraph and everything behind this switch.
 */
function analyticsOn(): boolean {
  return process.env.ANALYTICS_ENABLED === 'true';
}

/** Cookies set when a visitor arrives through a tracked or invite link. */
const ATTRIBUTION_COOKIES = [
  {
    name: 'kgc_ref',
    holds: "the code of a link we published, for example in a newsletter or a speaker's post.",
  },
  {
    name: 'kgc_invite',
    holds:
      'the referral code of the attendee who sent you a personal invite. If you buy a ticket, your registration keeps that code, so the organizers can see who invited whom.',
  },
  {
    name: 'kgc_utm',
    holds: 'the campaign tags on the link you followed (utm_source, utm_medium and utm_campaign).',
  },
];

/** Loaded only while `analyticsOn()`. Each works under its own terms, not ours. */
const ANALYTICS_SERVICES = [
  {
    name: 'Google Analytics',
    does: 'Measures how the site is used: pages viewed, the link that brought you, and ticket purchases (the order number, amount and ticket type, never your name or email address).',
  },
  {
    name: 'Google Tag Manager',
    does: 'Loads the measurement tags, including two that count clicks on the register and ticket buttons.',
  },
  {
    name: 'Apollo.io',
    does: 'Loaded through Tag Manager. Records visits to the site and may recognise the company a visit comes from, which we use to find organisations interested in the conference.',
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
  const analytics = analyticsOn();
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
        {analytics ? (
          <p>
            Only what running the conference needs, and the site analytics described under Cookies
            below. There is no advertising network on this site, and nothing about you is sold.
          </p>
        ) : (
          <p>
            Only what running the conference needs. There is no advertising network on this site, no
            third-party analytics script, and nothing about you is sold or shared for marketing.
          </p>
        )}
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
        {analytics && (
          <>
            <p>
              The site also loads three analytics services. They receive what your browser sends
              them while you are on the site, and each handles it under its own privacy terms.
            </p>
            <ul>
              {ANALYTICS_SERVICES.map((a) => (
                <li key={a.name} style={{ padding: '6px 0' }}>
                  <strong>{a.name}.</strong> {a.does}
                </li>
              ))}
            </ul>
          </>
        )}

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
          are signed in and what you have dismissed.
        </p>
        <p>
          Three more first-party cookies record how you reached the site, so a ticket purchase can
          be credited to the link or the person that sent you. They are set only when you arrive
          through such a link, last 30 days, and hold no name or email address:
        </p>
        <ul>
          {ATTRIBUTION_COOKIES.map((c) => (
            <li key={c.name} style={{ padding: '6px 0' }}>
              <strong>{c.name}</strong> holds {c.holds}
            </li>
          ))}
        </ul>
        {analytics ? (
          <>
            <p>
              Google Analytics, Google Tag Manager and Apollo.io set their own cookies to recognise a
              returning browser and measure visits. When you buy a ticket, a first-party cookie
              holding the order number, amount and ticket type lasts 15 minutes, so the confirmation
              page can report the purchase to Google Analytics once.
            </p>
            <p>
              Analytics runs unless your browser sends Do Not Track or Global Privacy Control, in
              which case none of it loads.
              {/* Only while the notice is shown (`consentNoticeOn`). */}
              {consentNoticeOn() && (
                <>
                  {' '}
                  A notice at the bottom of the page says the site uses cookies. Choosing Accept or
                  closing it hides it for a year; that choice is kept in your browser, not in a
                  cookie, and does not change what loads.
                </>
              )}
            </p>
          </>
        ) : (
          <p>There are no advertising cookies and no third-party analytics cookies.</p>
        )}

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
