import { PAGE_CONTENT_KEYS, type CodeOfConductContent } from '@kgc/shared';
import type { Metadata } from 'next';
import { pageContent } from '@/lib/data';
import { SITE } from '@/lib/site';

/**
 * The code of conduct, transcribed verbatim from
 * `knowledgegraph.tech/code-of-conduct/`.
 *
 * **Nothing here is paraphrased, and nothing should be.** This is the document
 * an attendee is told they have agreed to and the one an organizer enforces
 * against. A tidier sentence that changes what is prohibited, or drops one of
 * the ten listed sanctions, is a materially different policy. It is reproduced
 * as written, including the CC0 licence note and the FORCE11 attribution the
 * live page carries.
 *
 * The Executive Committee names are real people in real roles and are listed
 * because the policy's reporting route depends on them being named.
 *
 * This existed only as `/about#code-of-conduct` before — a fragment on another
 * page, which the footer linked to. The live site gives it its own page, and a
 * policy that people are asked to agree to should have an address of its own.
 */

export const metadata: Metadata = {
  title: 'Code of Conduct',
  description:
    'The code of conduct all attendees, speakers, sponsors and volunteers at the Knowledge Graph Conference agree to.',
};

const STANDARDS = [
  'All communication should be appropriate for a professional audience consisting of people of many different backgrounds. Sexual language and imagery is never appropriate in such a context, nor is language referring to personal qualities or characteristics or group membership.',
  'Be kind to others. Engage respectfully with ideas and never with person or identity. Insulting, degrading, or disrespectful behavior is never appropriate at KGC activities.',
  'Be mindful of jargon, slang, and cultural references that can exclude others from engaging in the discussion.',
  'Feel free to join new groups of people in conversation. When you are in a group, try leaving space for one more person to join you (the PAC-Man rule) as a way of encouraging others.',
];

const SANCTIONS = [
  'warning the person to cease their behavior and that any further reports will result in other sanctions;',
  'requiring that the person refrain from any interaction with the person harmed by their behavior for the remainder of the event;',
  'early termination of activities (such as online lectures, discussions, or other activities) that violate the policy;',
  'refusing to publish video or other material from a lecture or activity that violated the policy;',
  'cancelling subsequent appearances by a speaker or participant who violated the policy;',
  'immediately ending any volunteer responsibilities and privileges;',
  'preventing the person from holding a position of responsibility in future KGC events (either indefinitely or for a certain time period);',
  'requiring the person to cease participation or leave the event or online activity immediately and not return;',
  'banning the person from future events and online activities (either indefinitely or for a certain time period);',
  'publishing an account of the offending behavior (publication will never occur contrary to the wishes of those harmed by the offending behavior).',
];

/**
 * The reporting route, and the only part of this page an organizer can change
 * without a deploy.
 *
 * ── What is editable, and what deliberately is not ──────────────────────────
 *
 * Everything above this line — the standards, the ten sanctions, the prose — is
 * the policy. It stays in React. Changing it is a legal act with a named
 * enforcement consequence, it should leave a reviewable history, and there is
 * no approval step behind a dashboard text box. A tidier sentence typed at
 * 11pm that drops a sanction is a materially different document from the one
 * attendees agreed to.
 *
 * The reporting route is the opposite case. `Hazel Alvarado, Head of
 * Partnerships` is a person in a job, and people change jobs; the email is one
 * mailbox somebody has to still be reading. Those are the two things on this
 * page that go stale, and the moment they do, the page fails the one person it
 * exists for — somebody who has just been harassed and is looking for who to
 * tell. That is worth a database read.
 *
 * ⚠️ This constant is the fallback and must never be emptied to "let the CMS
 * fill it". `pageContent()` takes it as a required argument precisely so that
 * an empty collection, a wrong `eventId` or an unreachable Firestore all render
 * exactly what is written here.
 */
const CONTACT: CodeOfConductContent = {
  reportEmail: 'info@knowledgegraph.tech',
  committee: [
    'François Scharffe, Co-Founder, Conference Chair',
    'Thomas Deely, Co-Founder',
    'Hazel Alvarado, Head of Partnerships',
    'Joaquin Melara, COO',
  ],
};

/** The reporting route is read per request, so a change reaches the page at once. */
export const dynamic = 'force-dynamic';

export default async function CodeOfConductPage() {
  const { reportEmail, committee } = await pageContent(PAGE_CONTENT_KEYS.codeOfConduct, CONTACT);

  return (
    <section>
      <div className="wrap narrow">
        <p className="eyebrow">Policy</p>
        <h1>Code of Conduct of Knowledge Graphs Conference LLC</h1>
        <p className="lede">
          All attendees, speakers, sponsors and volunteers at The Knowledge Graph Conference (KGC)
          are required to agree with the following code of conduct.
        </p>
        <p>
          Organizers will enforce this code throughout the event. We expect cooperation from all
          participants to help ensure a safe environment for everybody.
        </p>

        <h2>The Knowledge Graph Conference</h2>
        <p>
          The event is community-organized and intended for networking, collaboration,
          dissemination of new ideas, and learning. Attendees consist of industry practitioners,
          developers, researchers, librarians, students, investors and more, across a wide variety
          of disciplines and geographic locations.
        </p>
        <p>
          Accordingly, The Knowledge Graph Conference organizers are dedicated to providing a
          harassment-free experience for everyone, regardless of gender identity and expression,
          age, sexual orientation, disability, physical appearance, body size, race, ethnicity,
          religion (or lack thereof), technology choices, or other group status. We value the
          participation of every participant and want all participants in KGC activities to have an
          enjoyable and fulfilling experience.
        </p>
        <p>
          Everyone taking part in KGC activities — whether in person or online — is expected to show
          respect and courtesy to others throughout their participation. In addition, we ask all
          attendees to adhere to the following standards of conduct:
        </p>
        <ul>
          {STANDARDS.map((s) => (
            <li key={s} style={{ padding: '6px 0' }}>
              {s}
            </li>
          ))}
        </ul>
        <p>
          We expect participants to follow these rules at all conference venues, conference-related
          social events and online.
        </p>

        <h2>Conflict resolution</h2>
        <p>
          We take a community approach to ensuring the safety and comfort of all attendees. Everyone
          is responsible for assisting in any circumstances where anyone appears to not be following
          the Code of Conduct. The KGC organizers commit to ensure the Code of Conduct is enforced.
        </p>
        <p>
          If someone makes you or anyone else feel unsafe or unwelcome, or otherwise violates the
          Code of Conduct, please report this as soon as possible to one of the KGC organizers. At
          any time, you can reach the organizers via email — see the contact details below. You can
          make a report either personally or anonymously. The organizers are committed to address
          and resolve the issue in question to the best of their abilities, and to reviewing this
          Code of Conduct regularly and learning from other organizations.
        </p>
        <p>
          Harassment and other code of conduct violations reduce the value of our organization for
          everyone. We want you to be happy and benefit from our event.
        </p>

        <h2>Sanctions</h2>
        <p>
          If a participant engages in harassing behavior, KGC and its organizers may take any action
          they deem appropriate, including warning the person in question, removing them from a
          specific KGC activity, or banning them from further participation in KGC activities, in
          person or online. Participants asked to stop any behavior that makes others uncomfortable
          are expected to comply immediately.
        </p>
        <p>
          Specific actions to enforce this Code of Conduct may include but are not limited to:
        </p>
        <ul>
          {SANCTIONS.map((s) => (
            <li key={s} style={{ padding: '6px 0' }}>
              {s}
            </li>
          ))}
        </ul>

        <h2>Contact</h2>
        <p>
          If an incident occurs, please contact one or all of the Executive Committee members
          directly, or using <a href={`mailto:${reportEmail}`}>{reportEmail}</a>.
        </p>
        <p>KGC Executive Committee members are:</p>
        <ul>
          {committee.map((m) => (
            <li key={m} style={{ padding: '4px 0' }}>
              {m}
            </li>
          ))}
        </ul>

        <p className="muted" style={{ marginTop: 40 }}>
          Licensed under CC0, inspired by the FORCE11 Code of Conduct. General enquiries:{' '}
          <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>.
        </p>
      </div>
    </section>
  );
}
