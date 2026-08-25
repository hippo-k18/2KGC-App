import 'server-only';

import {
  COLLECTIONS,
  EVENT_ID,
  type EmailLogDoc,
  type SpeakerDoc,
  type SponsorDoc,
  type UserDoc,
} from '@kgc/shared';
import { db } from './firestore';

/**
 * Bulk email to a named audience — Whova's "Message Speakers" / "Message
 * Sponsors" and their siblings.
 *
 * `gaps.ts` said these needed "an email sender. There is none anywhere in this
 * project yet." That stopped being true in August 2026, and this is what the
 * sender unblocked. The three screens differ only in which audience they
 * resolve, which is why the audience is a value here rather than three
 * near-identical modules.
 *
 * ── What is deliberately NOT here ───────────────────────────────────────────
 *
 * **Scheduling.** Whova lets you queue a send for later. The same argument that
 * kept it out of Announcements applies with more force to email: a queued blast
 * fires whether or not anybody is awake to stop it, and the classic failure is
 * 6am in the wrong timezone. A message goes out when a human presses the
 * button, in the room, awake.
 *
 * **Attendee mail.** Whova puts that under `tickets/ticket-marketing/email-campaign`
 * and it is a genuinely different tool — contact lists, link tracking, an
 * unsubscribe register. Forty-five speakers is a different problem from a
 * thousand attendees, and pretending otherwise is how a conference gets its
 * sending domain blocked. That screen stays a gap note until it is built
 * properly.
 *
 * **Drafts.** A draft is state that has to be owned, listed and cleaned up. The
 * form keeps what you typed across a failed send, which covers the real case.
 */

export type AudienceId = 'speakers' | 'sponsors';

export interface Recipient {
  id: string;
  name: string;
  email: string;
  /** Shown beside the name so an organizer can tell two people apart. */
  detail?: string;
}

export interface Audience {
  id: AudienceId;
  /** Whova's own label for the screen. */
  title: string;
  /** Plural noun for prose: "45 speakers". */
  noun: string;
  /** Filters an organizer can narrow the send to. */
  segments: { id: string; label: string; describe: string }[];
}

export const AUDIENCES: Record<AudienceId, Audience> = {
  speakers: {
    id: 'speakers',
    title: 'Message Speakers',
    noun: 'speakers',
    segments: [
      { id: 'all', label: 'Everyone', describe: 'Every speaker with an email address on file' },
      {
        id: 'incomplete',
        label: 'Incomplete profiles',
        // Whova's own segment, and the one that earns its keep: chasing bios and
        // headshots is most of what Message Speakers is used for.
        describe: 'Speakers missing a bio or a photo',
      },
      { id: 'no-session', label: 'Not on the agenda', describe: 'Speakers with no session yet' },
    ],
  },
  sponsors: {
    id: 'sponsors',
    title: 'Message Sponsors',
    noun: 'sponsors',
    segments: [
      { id: 'all', label: 'Everyone', describe: 'Every sponsor contact on file' },
      { id: 'no-logo', label: 'Missing a logo', describe: 'Sponsors with no logo uploaded' },
      { id: 'no-booth', label: 'No booth assigned', describe: 'Sponsors with no booth location' },
    ],
  },
};

/**
 * Resolve an audience and segment to the people who would actually be emailed.
 *
 * ⚠️ **Anyone with no email address is silently absent, and the caller must say
 * so.** A speaker record with no contact address is common — they were imported
 * from an agenda CSV — and a send that quietly reaches 38 of 45 people while
 * reporting success is the worst outcome available. `resolveAudience` therefore
 * returns the excluded count alongside the list, and both screens print it.
 */
export async function resolveAudience(
  audience: AudienceId,
  segment: string,
): Promise<{ recipients: Recipient[]; withoutEmail: number }> {
  if (audience === 'speakers') return resolveSpeakers(segment);
  return resolveSponsors(segment);
}

async function resolveSpeakers(segment: string) {
  const [speakerSnap, userSnap] = await Promise.all([
    db().collection(COLLECTIONS.speakers).where('eventId', '==', EVENT_ID).get(),
    db().collection(COLLECTIONS.users).where('eventId', '==', EVENT_ID).get(),
  ]);

  /**
   * Two possible addresses, in a deliberate order.
   *
   * `SpeakerDoc.contactEmail` is what the programme committee corresponds with,
   * known from the call for papers long before the speaker holds a ticket. The
   * `users` record is the fallback for speakers who signed up but whose contact
   * address was never captured. The committee's address wins because it may
   * deliberately differ from whichever one they bought a ticket with.
   */
  const emailByUid = new Map(
    userSnap.docs.map((d) => [d.id, (d.data() as UserDoc).email]),
  );

  let withoutEmail = 0;
  const recipients: Recipient[] = [];

  for (const d of speakerSnap.docs) {
    const s = d.data() as SpeakerDoc;

    if (segment === 'incomplete' && s.bio && s.photoURL) continue;
    if (segment === 'no-session' && (s.sessionIds ?? []).length > 0) continue;

    const email = s.contactEmail ?? (s.userId ? emailByUid.get(s.userId) : undefined);
    if (!email) {
      withoutEmail++;
      continue;
    }

    recipients.push({
      id: d.id,
      name: s.name,
      email,
      detail: [s.title, s.company].filter(Boolean).join(', ') || undefined,
    });
  }

  recipients.sort((a, b) => a.name.localeCompare(b.name));
  return { recipients, withoutEmail };
}

async function resolveSponsors(segment: string) {
  const snap = await db().collection(COLLECTIONS.sponsors).where('eventId', '==', EVENT_ID).get();

  let withoutEmail = 0;
  const recipients: Recipient[] = [];

  for (const d of snap.docs) {
    const s = d.data() as SponsorDoc;

    if (segment === 'no-logo' && s.logoURL) continue;
    if (segment === 'no-booth' && s.boothLocation) continue;

    const email = s.contactEmail;
    if (!email) {
      withoutEmail++;
      continue;
    }

    recipients.push({
      id: d.id,
      name: s.name,
      email,
      detail: s.tier ? `${s.tier} sponsor` : undefined,
    });
  }

  recipients.sort((a, b) => a.name.localeCompare(b.name));
  return { recipients, withoutEmail };
}

// ---------------------------------------------------------------------------
// Sent history
// ---------------------------------------------------------------------------

export interface CampaignRow {
  campaignId: string;
  subject: string;
  actor?: string;
  at: string;
  sent: number;
  failed: number;
  skipped: number;
}

/**
 * Past sends, grouped from the per-recipient rows in `emailLog`.
 *
 * Grouped at read time rather than stored as a campaign document, because the
 * per-recipient row is the one that answers the question people actually ask —
 * "did *Ada* get it?" — and a summary derived from those rows can never
 * disagree with them. A stored counter could.
 */
export async function listCampaigns(limit = 25): Promise<CampaignRow[]> {
  const snap = await db()
    .collection(COLLECTIONS.emailLog)
    .where('eventId', '==', EVENT_ID)
    .get();

  const byCampaign = new Map<string, CampaignRow>();

  for (const d of snap.docs) {
    const e = d.data() as EmailLogDoc;
    if (e.template !== 'bulk-message' || !e.campaignId) continue;

    let at: string;
    try {
      at = e.at.toDate().toISOString();
    } catch {
      at = new Date(0).toISOString();
    }

    const row =
      byCampaign.get(e.campaignId) ??
      ({
        campaignId: e.campaignId,
        subject: e.subject,
        actor: e.actor,
        at,
        sent: 0,
        failed: 0,
        skipped: 0,
      } satisfies CampaignRow);

    if (e.status === 'sent') row.sent++;
    else if (e.status === 'failed') row.failed++;
    else row.skipped++;

    // The campaign's timestamp is its earliest row: a send of 400 people spans
    // a minute or two, and "when did this go out" means when it started.
    if (at < row.at) row.at = at;

    byCampaign.set(e.campaignId, row);
  }

  return [...byCampaign.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

/** Every recipient of one campaign, for the "did Ada get it?" question. */
export async function campaignRecipients(campaignId: string): Promise<
  { to: string; status: EmailLogDoc['status']; error?: string; reason?: string }[]
> {
  const snap = await db()
    .collection(COLLECTIONS.emailLog)
    .where('eventId', '==', EVENT_ID)
    .where('campaignId', '==', campaignId)
    .get();

  return snap.docs
    .map((d) => {
      const e = d.data() as EmailLogDoc;
      return { to: e.to, status: e.status, error: e.error, reason: e.reason };
    })
    .sort((a, b) => a.to.localeCompare(b.to));
}
