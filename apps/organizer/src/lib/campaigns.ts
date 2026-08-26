import 'server-only';

import { createHash } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  EVENT_ID,
  type CampaignLinkDoc,
  type ContactDoc,
} from '@kgc/shared';
import { appendAudit } from './audit';
import { listOrders, type OrderRow } from './commerce';
import { recordError } from './errors';
import { db } from './firestore';

/**
 * Ticket marketing: the contact list, the tracked links, and what they earned.
 *
 * Whova splits this across seven screens — Campaign Contact List, Email
 * Campaign, Campaign Link Tracking, Referral Contest, Social Sharing, Event
 * Website, Event Listing. Underneath there are only two things: a list of
 * people to email, and a set of links that count clicks and get credit for
 * purchases. Everything else is a different way of reading those two.
 *
 * ── Contacts are not registrations, and the distinction is load-bearing ─────
 *
 * A contact has bought nothing. Last year's delegates, a partner's list, the
 * "notify me" form. Folding them into `registrations` would put people holding
 * no ticket into the collection that decides who gets through the door.
 *
 * ── The suppression check is the most important code in this file ───────────
 *
 * ⚠️ A conference that emails people who asked it to stop gets its sending
 * domain blocked, and the damage lands on the *transactional* mail — receipts
 * and claim codes — not on the newsletter that caused it. So unsubscribed and
 * bounced addresses are removed from every audience this module resolves, and
 * the count of removals is returned so the screen can print it. A send that
 * quietly reaches 800 of 1,000 while reporting success is the worst available
 * outcome; a send that reaches 800 and says why is fine.
 */

/** Same derivation `registrations` uses, so the same person maps to one document. */
export function contactId(email: string): string {
  return `contact_${createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32)}`;
}

export interface ContactRow {
  id: string;
  email: string;
  name: string;
  company: string;
  source: string;
  lists: string[];
  unsubscribedAt?: string;
  bouncedAt?: string;
  converted: boolean;
  createdAt: string;
}

function iso(t: { toDate(): Date } | undefined): string | undefined {
  try {
    return t?.toDate().toISOString();
  } catch {
    return undefined;
  }
}

function toContactRow(id: string, c: ContactDoc): ContactRow {
  return {
    id,
    email: c.email,
    name: c.name ?? '',
    company: c.company ?? '',
    source: c.source ?? '',
    lists: c.lists ?? [],
    unsubscribedAt: iso(c.unsubscribedAt),
    bouncedAt: iso(c.bouncedAt),
    converted: c.converted === true,
    createdAt: iso(c.createdAt) ?? new Date(0).toISOString(),
  };
}

export async function listContacts(): Promise<ContactRow[]> {
  try {
    const snap = await db().collection(COLLECTIONS.contacts).where('eventId', '==', EVENT_ID).get();
    return snap.docs
      .map((d) => toContactRow(d.id, d.data() as ContactDoc))
      .sort((a, b) => a.email.localeCompare(b.email));
  } catch (err) {
    recordError('campaigns.listContacts', err);
    return [];
  }
}

export interface ContactSummary {
  total: number;
  mailable: number;
  unsubscribed: number;
  bounced: number;
  converted: number;
  /** Every distinct list name, with how many contacts are on it. */
  lists: { name: string; count: number; mailable: number }[];
}

export function summariseContacts(contacts: ContactRow[]): ContactSummary {
  const counts = new Map<string, { count: number; mailable: number }>();

  for (const c of contacts) {
    const ok = mailable(c);
    for (const l of c.lists) {
      const row = counts.get(l) ?? { count: 0, mailable: 0 };
      row.count++;
      if (ok) row.mailable++;
      counts.set(l, row);
    }
  }

  return {
    total: contacts.length,
    mailable: contacts.filter(mailable).length,
    unsubscribed: contacts.filter((c) => c.unsubscribedAt).length,
    bounced: contacts.filter((c) => c.bouncedAt).length,
    converted: contacts.filter((c) => c.converted).length,
    lists: [...counts.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}

/** The suppression check, in one place so no caller can forget half of it. */
export function mailable(c: ContactRow): boolean {
  return !c.unsubscribedAt && !c.bouncedAt;
}

/**
 * Everyone on one list who may actually be emailed.
 *
 * Returns the suppressed count separately rather than folding it into the list,
 * because the screen has to say "1,000 on this list, 62 suppressed, 938 will
 * receive this" — three numbers, not one.
 */
export function audienceFor(
  contacts: ContactRow[],
  list: string,
): { recipients: ContactRow[]; suppressed: number } {
  const onList = list === '*' ? contacts : contacts.filter((c) => c.lists.includes(list));
  const recipients = onList.filter(mailable);
  return { recipients, suppressed: onList.length - recipients.length };
}

// ---------------------------------------------------------------------------
// Importing contacts
// ---------------------------------------------------------------------------

export interface ImportOutcome {
  created: number;
  updated: number;
  skipped: { row: number; email: string; why: string }[];
  suppressedKept: number;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Add or update contacts from parsed CSV rows.
 *
 * ── Re-importing is the normal case, not the exception ──────────────────────
 *
 * The id is derived from the address, so importing an updated file corrects
 * names rather than doubling the list. Lists are *merged* rather than replaced:
 * a contact already on "KGC 2026 attendees" who appears in a "workshop
 * waitlist" import belongs on both, and replacing would quietly remove them
 * from the first.
 *
 * ── An import never resurrects an unsubscribe ───────────────────────────────
 *
 * ⚠️ This is the rule that matters. Uploading last year's full list would
 * otherwise clear every unsubscribe recorded since — which is both the fastest
 * way to lose a sending domain and, in several jurisdictions, unlawful. So
 * `unsubscribedAt` and `bouncedAt` are never written by an import, and the
 * number of suppressed contacts the file touched is reported back so the
 * organizer sees that their 1,000-row upload will mail 938 people.
 */
export async function importContacts(input: {
  rows: { email: string; name?: string; company?: string; source?: string }[];
  list: string;
  actor: string;
}): Promise<ImportOutcome> {
  const outcome: ImportOutcome = { created: 0, updated: 0, skipped: [], suppressedKept: 0 };
  const list = input.list.trim();

  const seen = new Set<string>();

  for (const [i, raw] of input.rows.entries()) {
    const email = (raw.email ?? '').trim().toLowerCase();
    const rowNumber = i + 2; // 1-indexed, plus the header the organizer sees.

    if (!EMAIL.test(email)) {
      outcome.skipped.push({ row: rowNumber, email: raw.email ?? '', why: 'not an email address' });
      continue;
    }
    if (seen.has(email)) {
      // A duplicate inside one file. Reported rather than silently collapsed:
      // it usually means the file was concatenated from two exports.
      outcome.skipped.push({ row: rowNumber, email, why: 'appears earlier in this file' });
      continue;
    }
    seen.add(email);

    const id = contactId(email);
    const ref = db().collection(COLLECTIONS.contacts).doc(id);

    try {
      const snap = await ref.get();
      const existing = snap.exists ? (snap.data() as ContactDoc) : undefined;

      if (existing?.unsubscribedAt || existing?.bouncedAt) outcome.suppressedKept++;

      await ref.set(
        {
          eventId: EVENT_ID,
          email,
          ...(raw.name?.trim() ? { name: raw.name.trim() } : {}),
          ...(raw.company?.trim() ? { company: raw.company.trim() } : {}),
          ...(raw.source?.trim() ? { source: raw.source.trim() } : {}),
          // Merged, not replaced — see the docblock.
          lists: list ? FieldValue.arrayUnion(list) : (existing?.lists ?? []),
          // `unsubscribedAt` and `bouncedAt` are deliberately absent from this
          // write. An import must never clear a suppression.
          ...(existing ? {} : { createdAt: FieldValue.serverTimestamp(), lists: list ? [list] : [] }),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      if (existing) outcome.updated++;
      else outcome.created++;
    } catch (err) {
      recordError('campaigns.importContacts', err);
      outcome.skipped.push({ row: rowNumber, email, why: 'write failed' });
    }
  }

  await appendAudit({
    actor: input.actor,
    action: 'contact.import',
    targetPath: COLLECTIONS.contacts,
    targetId: list || 'all',
    before: {},
    after: {
      list,
      created: outcome.created,
      updated: outcome.updated,
      skipped: outcome.skipped.length,
      suppressedKept: outcome.suppressedKept,
    },
  });

  return outcome;
}

/** Record an unsubscribe, or lift one. Never done implicitly by anything. */
export async function setContactSubscribed(input: {
  contactId: string;
  subscribed: boolean;
  actor: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    await db()
      .collection(COLLECTIONS.contacts)
      .doc(input.contactId)
      .update({
        unsubscribedAt: input.subscribed ? FieldValue.delete() : Timestamp.now(),
        updatedAt: FieldValue.serverTimestamp(),
      });

    await appendAudit({
      actor: input.actor,
      action: 'contact.import',
      targetPath: `${COLLECTIONS.contacts}/${input.contactId}`,
      targetId: input.contactId,
      before: {},
      after: { unsubscribed: !input.subscribed },
    });

    return { ok: true };
  } catch (err) {
    recordError('campaigns.setSubscribed', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not update the contact.' };
  }
}

// ---------------------------------------------------------------------------
// Tracked links
// ---------------------------------------------------------------------------

export interface LinkRow {
  code: string;
  label: string;
  destination: string;
  owner: string;
  channel: string;
  clicks: number;
  active: boolean;
  lastClickedAt?: string;
  /** Purchases whose `campaignCode` is this link's, excluding demo orders. */
  orders: number;
  /** What those purchases were worth, net of refunds, in minor units. */
  revenueCents: number;
  currency: string;
  /** Orders per click. Undefined rather than zero when nothing has clicked. */
  conversion?: number;
}

function toLinkRow(id: string, l: CampaignLinkDoc, attributed: OrderRow[]): LinkRow {
  const clicks = l.clicks ?? 0;
  const revenueCents = attributed.reduce((n, o) => n + o.netCents, 0);

  return {
    code: l.code || id,
    label: l.label ?? '',
    destination: l.destination ?? '/',
    owner: l.owner ?? '',
    channel: l.channel ?? '',
    clicks,
    active: l.active !== false,
    lastClickedAt: iso(l.lastClickedAt),
    orders: attributed.length,
    revenueCents,
    currency: attributed[0]?.currency ?? 'usd',
    // Undefined, not zero, when nothing has clicked. "0% conversion" on a link
    // nobody has opened reads as a failed campaign rather than an unsent one.
    conversion: clicks > 0 ? attributed.length / clicks : undefined,
  };
}

/**
 * Every tracked link, with what it actually earned.
 *
 * The join is `OrderDoc.campaignCode`, written at fulfilment from the cookie
 * `/r/{code}` set. Demo orders are excluded for the same reason they are
 * excluded from every takings figure: no money moved, and a referral contest
 * decided by demo purchases is decided by nothing.
 */
export async function listLinks(): Promise<LinkRow[]> {
  try {
    const [snap, orders] = await Promise.all([
      db().collection(COLLECTIONS.campaignLinks).where('eventId', '==', EVENT_ID).get(),
      listOrders(),
    ]);

    const real = orders.filter((o) => o.channel !== 'demo' && o.status !== 'cancelled');
    const byCode = new Map<string, OrderRow[]>();
    for (const o of real) {
      if (!o.campaignCode) continue;
      byCode.set(o.campaignCode, [...(byCode.get(o.campaignCode) ?? []), o]);
    }

    return snap.docs
      .map((d) => toLinkRow(d.id, d.data() as CampaignLinkDoc, byCode.get(d.id) ?? []))
      .sort((a, b) => b.clicks - a.clicks || a.code.localeCompare(b.code));
  } catch (err) {
    recordError('campaigns.listLinks', err);
    return [];
  }
}

export type LinkResult = { ok: true; message: string; code?: string } | { ok: false; error: string };

/**
 * Create or edit a tracked link.
 *
 * ── The destination must be a same-site path ────────────────────────────────
 *
 * ⚠️ Refused here *and* again in the redirect route. An absolute URL would make
 * `/r/{code}` an open redirect on the conference's own domain, which is exactly
 * the primitive a phishing campaign wants — a link that genuinely starts at
 * `knowledgegraph.tech` and ends somewhere else. One check would be enough if
 * the only writer were this function; there are two because the redirect reads
 * a database and a database is not a trust boundary.
 */
export async function saveLink(input: {
  code: string;
  label: string;
  destination: string;
  owner?: string;
  channel?: string;
  actor: string;
}): Promise<LinkResult> {
  const code = input.code.trim().toLowerCase();

  if (!/^[a-z0-9-]{2,48}$/.test(code)) {
    return {
      ok: false,
      error: 'A code is 2–48 lower-case letters, digits and hyphens. It appears in the public URL.',
    };
  }
  if (input.label.trim().length < 3) {
    return { ok: false, error: 'Give the link a label — in six months nobody remembers what "q2b" was.' };
  }

  const destination = input.destination.trim() || '/tickets';
  if (!destination.startsWith('/') || destination.startsWith('//')) {
    return {
      ok: false,
      error:
        'The destination must be a path on this site, starting with a single "/". ' +
        'An absolute URL would turn /r/… into an open redirect on the conference’s own domain.',
    };
  }

  try {
    const ref = db().collection(COLLECTIONS.campaignLinks).doc(code);
    const existed = (await ref.get()).exists;

    await ref.set(
      {
        eventId: EVENT_ID,
        code,
        label: input.label.trim(),
        destination,
        owner: input.owner?.trim() || FieldValue.delete(),
        channel: input.channel?.trim() || FieldValue.delete(),
        // Never written on an update: editing a label must not reset the count
        // a campaign has been accumulating for a month.
        ...(existed ? {} : { clicks: 0, active: true, createdAt: FieldValue.serverTimestamp() }),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    await appendAudit({
      actor: input.actor,
      action: existed ? 'campaign.update' : 'campaign.create',
      targetPath: `${COLLECTIONS.campaignLinks}/${code}`,
      targetId: code,
      before: {},
      after: { code, label: input.label, destination, owner: input.owner ?? null },
    });

    return {
      ok: true,
      code,
      message: existed ? `Updated /r/${code}.` : `Created /r/${code}.`,
    };
  } catch (err) {
    recordError('campaigns.saveLink', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not save the link.' };
  }
}

/**
 * Retire a link, or bring it back.
 *
 * Retiring rather than deleting: the clicks and the attributed orders are the
 * record of what a campaign achieved, and deleting the link deletes the only
 * thing that explains why a month's sales spiked. A retired link 404s.
 */
export async function setLinkActive(code: string, active: boolean, actor: string): Promise<LinkResult> {
  try {
    await db()
      .collection(COLLECTIONS.campaignLinks)
      .doc(code)
      .update({ active, updatedAt: FieldValue.serverTimestamp() });

    await appendAudit({
      actor,
      action: 'campaign.update',
      targetPath: `${COLLECTIONS.campaignLinks}/${code}`,
      targetId: code,
      before: { active: !active },
      after: { active },
    });

    return {
      ok: true,
      message: active ? `/r/${code} is live again.` : `/r/${code} now 404s. Its history is kept.`,
    };
  } catch (err) {
    recordError('campaigns.setLinkActive', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not update the link.' };
  }
}
