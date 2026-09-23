import 'server-only';

import { FieldValue } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  SUBCOLLECTIONS,
  publicSiteOrigin,
  type ExhibitorDoc,
} from '@kgc/shared';
import { mintExhibitorToken } from '@kgc/scripts/src/lib/exhibitor-token';
import { emailEnabled, sendExhibitorLeadLink } from '@kgc/scripts/src/lib/email';
import { appendAudit } from './audit';
import { db } from './firestore';
import { recordError } from './errors';

/**
 * The organizer's half of exhibitor lead capture: sending the link, stopping
 * it, and seeing whether a stand is using it.
 *
 * ── Why the counting is a read per exhibitor ────────────────────────────────
 *
 * There are six exhibitors. `leads` is a subcollection under each, and the
 * alternative to six small counts is a denormalised total on the exhibitor
 * document that the website would have to maintain from a different process —
 * a counter with two writers and no transaction between them. Six reads on a
 * screen an organizer opens a handful of times before the hall opens is the
 * cheaper mistake to make. If the hall ever has two hundred stands, the number
 * moves to a trigger, not to a second writer.
 *
 * `count()` rather than fetching the documents: the dashboard has no business
 * holding a company's contacts, and an aggregation query returns a number
 * without the rows. The leads themselves are the exhibitor's, read on their own
 * page through their own link.
 */

export interface LeadLinkRow {
  exhibitorId: string;
  /** Epoch ms of the last send, absent when nothing has been sent. */
  sentAtMs?: number;
  sentTo?: string;
  /** Epoch ms. Every link minted before this is refused. */
  validFrom?: number;
  /** How many people have agreed to be on this stand's list. */
  leadCount: number;
}

const millis = (t: unknown): number | undefined => {
  const v = t as { toMillis?: () => number } | undefined;
  return typeof v?.toMillis === 'function' ? v.toMillis() : undefined;
};

/**
 * A working link to one stand's lead desk, minted now.
 *
 * `publicSiteOrigin()` rather than the requesting host, for the reason
 * `speakerPortalLink` gives: the dashboard has no request to read at the moment
 * it mails one, and a link built from a `Host` header is a link built from
 * whatever a proxy said.
 */
export const leadDeskLink = (exhibitorId: string) =>
  `${publicSiteOrigin()}/exhibitor/${mintExhibitorToken(exhibitorId)}`;

/**
 * Whether a link can be minted at all.
 *
 * `mintExhibitorToken` throws when neither `WEB_EXHIBITOR_SECRET` nor
 * `WEB_ORDER_SECRET` is configured. On such a deployment the screen has to say
 * so in one sentence rather than fail inside a button press.
 */
export function leadLinksAvailable(): boolean {
  try {
    mintExhibitorToken('probe');
    return true;
  } catch (err) {
    recordError('exhibitor-leads.token', err);
    return false;
  }
}

/** Whether pressing Send now would leave this server as an email. */
export const leadEmailAvailable = (): boolean => emailEnabled();

export async function leadLinkRows(exhibitorIds: string[]): Promise<Record<string, LeadLinkRow>> {
  const out: Record<string, LeadLinkRow> = {};
  if (exhibitorIds.length === 0) return out;

  const refs = exhibitorIds.map((id) => db().collection(COLLECTIONS.exhibitors).doc(id));
  const docs = await db().getAll(...refs);

  await Promise.all(
    docs.map(async (d) => {
      if (!d.exists) return;
      const e = d.data() as ExhibitorDoc;
      let leadCount = 0;
      try {
        const agg = await d.ref.collection(SUBCOLLECTIONS.leads).count().get();
        leadCount = agg.data().count;
      } catch (err) {
        // A count that cannot be read is reported as zero and logged, not as a
        // screen that refuses to render the rest of the exhibitor list.
        recordError('exhibitor-leads.count', err);
      }
      out[d.id] = {
        exhibitorId: d.id,
        sentAtMs: millis(e.leadLinkSentAt),
        sentTo: e.leadLinkSentTo,
        validFrom: e.leadLinksValidFrom,
        leadCount,
      };
    }),
  );

  return out;
}

export interface LeadLinkResult {
  ok: boolean;
  message?: string;
  error?: string;
}

/**
 * Mail one exhibitor their lead desk link, and record that it went.
 *
 * The same button is the reminder, and each press mints a fresh link — so an
 * organizer never has to think about which of somebody's links is the live one.
 *
 * ⚠️ Sending does **not** clear a revocation. `leadLinksValidFrom` stays where
 * it is, and the freshly minted link has an `iat` after it, so the new one
 * opens and the old ones stay dead. Clearing the field would quietly bring
 * every previously revoked link back to life.
 */
export async function sendLeadLink(input: {
  exhibitorId: string;
  note?: string;
  actor: string;
}): Promise<LeadLinkResult> {
  try {
    const ref = db().collection(COLLECTIONS.exhibitors).doc(input.exhibitorId);
    const snap = await ref.get();
    if (!snap.exists) return { ok: false, error: 'That exhibitor does not exist.' };

    const exhibitor = snap.data() as ExhibitorDoc;
    if (exhibitor.status === 'cancelled') {
      return {
        ok: false,
        error: `${exhibitor.name} is cancelled, so their link would not open. Reinstate them first.`,
      };
    }

    const to = exhibitor.contactEmail?.trim();
    if (!to) {
      return {
        ok: false,
        error: `There is no address on file for ${exhibitor.name}, so there is nowhere to send the link. Add one on their record first.`,
      };
    }

    await sendExhibitorLeadLink(db(), {
      to,
      companyName: exhibitor.name,
      contactName: exhibitor.contactName,
      link: leadDeskLink(input.exhibitorId),
      boothNumber: exhibitor.boothNumber,
      note: input.note?.trim() || undefined,
      actor: input.actor,
    });

    /*
     * Stamped only when a mail actually left. "Link sent" on this screen must
     * not be true of a stand that was never written to — that is the difference
     * between a list of what has happened and a list of what was intended.
     */
    if (emailEnabled()) {
      await ref.update({
        leadLinkSentAt: FieldValue.serverTimestamp(),
        leadLinkSentTo: to,
        updatedAt: new Date(),
      });
    }

    await appendAudit({
      actor: input.actor,
      action: 'exhibitor.leadLinkSend',
      targetPath: `${COLLECTIONS.exhibitors}/${input.exhibitorId}`,
      targetId: input.exhibitorId,
      before: {},
      after: { to, emailed: emailEnabled() },
    });

    return {
      ok: true,
      message: emailEnabled()
        ? `Link sent to ${to}.`
        : `Email is not switched on yet, so nothing was sent to ${to}. Copy the link from the row and send it yourself.`,
    };
  } catch (err) {
    recordError('exhibitor-leads.send', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not send the link.' };
  }
}

/**
 * Kill every link this exhibitor has been sent.
 *
 * One field write, because `exhibitor-token.ts` holds no state: the token
 * carries `iat` and `exhibitorLinkOpens` refuses anything minted before this
 * instant. It stops one stand's links and nobody else's, which rotating the
 * signing secret could not do.
 *
 * ⚠️ It stops the reading as well as the scanning — the page, the actions and
 * the CSV route all go through `openLeadDesk`. The leads themselves are not
 * touched: they are a record of people who agreed, and deleting them because a
 * link was revoked would destroy a consent record to close a session.
 */
export async function revokeLeadLinks(input: {
  exhibitorId: string;
  actor: string;
}): Promise<LeadLinkResult> {
  try {
    const ref = db().collection(COLLECTIONS.exhibitors).doc(input.exhibitorId);
    const snap = await ref.get();
    if (!snap.exists) return { ok: false, error: 'That exhibitor does not exist.' };

    const at = Date.now();
    await ref.update({ leadLinksValidFrom: at, updatedAt: new Date() });

    await appendAudit({
      actor: input.actor,
      action: 'exhibitor.leadLinkRevoke',
      targetPath: `${COLLECTIONS.exhibitors}/${input.exhibitorId}`,
      targetId: input.exhibitorId,
      before: { leadLinksValidFrom: (snap.data() as ExhibitorDoc).leadLinksValidFrom ?? null },
      after: { leadLinksValidFrom: at },
    });

    return {
      ok: true,
      message:
        'Every link sent to this stand has stopped working, including the spreadsheet download. The leads they have already taken are kept. Send a new link to let them back in.',
    };
  } catch (err) {
    recordError('exhibitor-leads.revoke', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not stop the link.' };
  }
}

/** The whole hall's total, for the screen's stat tile. */
export function totalLeads(rows: Record<string, LeadLinkRow>): number {
  return Object.values(rows).reduce((n, r) => n + r.leadCount, 0);
}
