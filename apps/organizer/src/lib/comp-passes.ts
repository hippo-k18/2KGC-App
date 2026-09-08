import 'server-only';

import { FieldValue } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  EVENT_ID,
  publicSiteOrigin,
  type OrderDoc,
  type TicketAudience,
  type TicketTypeDoc,
} from '@kgc/shared';
import {
  MAX_COMP_PASSES,
  compPassesForOrder,
  compPassesPerUnit,
  listCompPasses,
  readCompPassAllocation,
  redeemCompPass,
  renameCompPass,
  type CompPassAllocation,
} from '@kgc/scripts/src/lib/comp-passes';
import { sendPurchaseConfirmation } from '@kgc/scripts/src/lib/email';
import { mintOrderToken } from '@kgc/scripts/src/lib/order-token';
import { appendAudit } from './audit';
import { recordError } from './errors';
import { db } from './firestore';

/**
 * The dashboard's side of complimentary passes.
 *
 * The allocation itself — what refuses the fifth pass on a four-pass
 * sponsorship — is in `@kgc/scripts/src/lib/comp-passes.ts`, beside
 * `ensureRegistration`, because it is domain logic and because it has to be
 * testable against the emulator without a Next.js server. What is here is what
 * only the dashboard needs: the index of sponsorships that owe passes, the
 * audit entries, and the confirmation email a named attendee gets.
 *
 * ── Reading the tier count without going through `commerce.ts` ──────────────
 *
 * `TicketTypeRow` is the money read model — price, window, sold count. A
 * complimentary pass is not a payment and reaches no processor, so the
 * entitlement fields are read here instead of widening that model with a field
 * only these two screens use.
 */

export { MAX_COMP_PASSES };
export type { CompPassAllocation };

/** A tier that grants passes, for the small editor on the sponsor catalogue. */
export interface PassGrantingTier {
  id: string;
  name: string;
  audience: TicketAudience;
  complimentaryPasses: number;
}

/** Every tier in one audience, with whatever pass count it currently carries. */
export async function tiersWithPassCounts(audience: TicketAudience): Promise<PassGrantingTier[]> {
  try {
    const snap = await db()
      .collection(COLLECTIONS.ticketTypes)
      .where('eventId', '==', EVENT_ID)
      .get();

    return snap.docs
      .map((d) => {
        const t = d.data() as TicketTypeDoc;
        return {
          id: d.id,
          name: t.name,
          audience: (t.audience ?? 'attendee') as TicketAudience,
          complimentaryPasses: typeof t.complimentaryPasses === 'number' ? t.complimentaryPasses : 0,
          sortOrder: t.sortOrder ?? 0,
        };
      })
      .filter((t) => t.audience === audience)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map(({ id, name, audience: a, complimentaryPasses }) => ({
        id,
        name,
        audience: a,
        complimentaryPasses,
      }));
  } catch (err) {
    recordError('compPasses.tiers', err);
    return [];
  }
}

/** One purchase that owes passes, as the index table renders it. */
export interface SponsorshipRow {
  orderId: string;
  buyer: string;
  companyName?: string;
  status: OrderDoc['status'];
  packages: string[];
  total: number;
  issued: number;
  remaining: number;
}

/**
 * Every order whose lines include complimentary passes.
 *
 * The join is the same one `audience-orders.tsx` performs and for the same
 * reason: an order carries no audience and no entitlement, the ticket type
 * carries both, and denormalising either onto the order at fulfilment would
 * freeze it at whatever the catalogue happened to say that afternoon.
 *
 * Demo-channel orders are excluded exactly as they are from every ledger. A
 * pass minted against one would be a real registration, so counting them here
 * would invite issuing one.
 */
export async function sponsorshipsWithPasses(): Promise<SponsorshipRow[]> {
  try {
    const store = db();
    const [orderSnap, perUnit, passes] = await Promise.all([
      store.collection(COLLECTIONS.orders).where('eventId', '==', EVENT_ID).get(),
      compPassesPerUnit(store),
      listCompPasses(store),
    ]);

    const issuedByOrder = new Map<string, number>();
    for (const p of passes) {
      issuedByOrder.set(p.orderId, (issuedByOrder.get(p.orderId) ?? 0) + 1);
    }

    const rows: SponsorshipRow[] = [];

    for (const doc of orderSnap.docs) {
      const order = doc.data() as OrderDoc;
      if (order.channel === 'demo') continue;

      const { total, sources } = compPassesForOrder(order.items, perUnit);
      if (total === 0) continue;

      const issued = issuedByOrder.get(doc.id) ?? 0;
      rows.push({
        orderId: doc.id,
        buyer: order.buyerName || order.email,
        companyName: order.companyName,
        status: order.status,
        packages: sources.map((s) => (s.quantity > 1 ? `${s.ticketTypeName} × ${s.quantity}` : s.ticketTypeName)),
        total,
        issued,
        remaining: Math.max(0, total - issued),
      });
    }

    // Sponsorships with seats still to fill first: that is the whole reason an
    // organizer opens this screen.
    return rows.sort(
      (a, b) => b.remaining - a.remaining || a.buyer.localeCompare(b.buyer),
    );
  } catch (err) {
    recordError('compPasses.sponsorships', err);
    return [];
  }
}

export async function allocationFor(orderId: string): Promise<CompPassAllocation | null> {
  try {
    return await readCompPassAllocation(db(), orderId);
  } catch (err) {
    recordError('compPasses.allocation', err);
    return null;
  }
}

export type CompPassActionResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * Set how many passes a package includes.
 *
 * Writes one field and nothing else. It is deliberately not part of the ticket
 * editor's save: that form owns price, window and copy, and a comped pass has
 * no price. Lowering the number below what a sponsor has already named does not
 * withdraw anybody — the screen reports the over-issue instead, because
 * cancelling a registration somebody is already holding a badge for is not a
 * side effect a number box may have.
 */
export async function setComplimentaryPasses(input: {
  ticketTypeId: string;
  passes: number;
  actor: string;
}): Promise<CompPassActionResult> {
  const { ticketTypeId, passes, actor } = input;

  if (!Number.isInteger(passes) || passes < 0 || passes > MAX_COMP_PASSES) {
    return {
      ok: false,
      error: `Passes must be a whole number between 0 and ${MAX_COMP_PASSES}.`,
    };
  }

  try {
    const ref = db().collection(COLLECTIONS.ticketTypes).doc(ticketTypeId);
    const snap = await ref.get();
    if (!snap.exists) return { ok: false, error: 'That package no longer exists.' };

    const tier = snap.data() as TicketTypeDoc;
    if (tier.eventId !== EVENT_ID) {
      return { ok: false, error: 'That package belongs to another event.' };
    }

    /**
     * Zero clears the field rather than storing `0`.
     *
     * The stores run with `ignoreUndefinedProperties`, so writing `undefined`
     * on a merge would write no key at all and quietly keep the old count — the
     * failure mode AGENTS.md gotcha 9 describes, and one where "saved" would
     * mean the package still promises passes it no longer includes.
     */
    await ref.update({
      complimentaryPasses: passes > 0 ? passes : FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await appendAudit({
      actor,
      action: 'ticketType.complimentaryPasses',
      targetPath: `${COLLECTIONS.ticketTypes}/${ticketTypeId}`,
      targetId: ticketTypeId,
      before: { complimentaryPasses: tier.complimentaryPasses ?? 0 },
      after: { complimentaryPasses: passes },
    });

    return {
      ok: true,
      message:
        passes > 0
          ? `${tier.name} now includes ${passes} complimentary ${passes === 1 ? 'pass' : 'passes'} per unit sold.`
          : `${tier.name} no longer includes complimentary passes.`,
    };
  } catch (err) {
    recordError('compPasses.setCount', err);
    return { ok: false, error: 'Could not save the pass count.' };
  }
}

/**
 * Name one attendee against a sponsorship, and tell them.
 *
 * The email is the same one a buyer gets, at zero, because the pass *is* the
 * same thing a purchase produces and the claim code is the only way the holder
 * reaches the app. It is sent last and cannot throw upward:
 * `sendPurchaseConfirmation` records its own failures in `emailLog`, so a bad
 * address never undoes a registration that is already correct.
 */
export async function issueCompPass(input: {
  orderId: string;
  name: string;
  email: string;
  silent: boolean;
  actor: string;
}): Promise<CompPassActionResult> {
  const store = db();

  let result;
  try {
    result = await redeemCompPass(store, {
      orderId: input.orderId,
      name: input.name,
      email: input.email,
      actor: input.actor,
    });
  } catch (err) {
    recordError('compPasses.issue', err);
    return { ok: false, error: 'Could not issue the pass.' };
  }

  if (!result.ok) return result;

  await appendAudit({
    actor: input.actor,
    action: 'compPass.issue',
    targetPath: `${COLLECTIONS.compPasses}/${input.orderId}__seat-${result.seat}`,
    targetId: input.orderId,
    before: {},
    after: {
      seat: result.seat,
      email: result.email,
      name: result.name,
      ticketType: result.ticketTypeName,
      registrationId: result.registrationId,
    },
  });

  if (!input.silent) {
    try {
      await sendPurchaseConfirmation(store, {
        to: result.email,
        name: result.name,
        ticketType: result.ticketTypeName,
        // A comp costs nothing, and saying so on the confirmation is the point:
        // the holder has a ticket and no receipt to look for.
        amountCents: 0,
        currency: 'usd',
        orderUrl: `${publicSiteOrigin()}/order/${mintOrderToken({ rid: result.registrationId })}`,
        claimCode: result.claimCode,
        orderId: input.orderId,
        registrationId: result.registrationId,
      });
    } catch (err) {
      recordError('compPasses.issue.email', err);
    }
  }

  return {
    ok: true,
    message:
      `Seat ${result.seat} of ${result.total} issued to ${result.name} (${result.email}). ` +
      `${result.remaining} ${result.remaining === 1 ? 'pass' : 'passes'} left.` +
      (input.silent ? ' No email was sent.' : ' A confirmation has been sent.'),
  };
}

/** Correct the name on an issued pass. The address and the badge are untouched. */
export async function correctCompPassName(input: {
  orderId: string;
  seat: number;
  name: string;
  actor: string;
}): Promise<CompPassActionResult> {
  try {
    const result = await renameCompPass(db(), {
      orderId: input.orderId,
      seat: input.seat,
      name: input.name,
    });
    if (!result.ok) return result;

    await appendAudit({
      actor: input.actor,
      action: 'compPass.rename',
      targetPath: `${COLLECTIONS.compPasses}/${input.orderId}__seat-${input.seat}`,
      targetId: input.orderId,
      before: {},
      after: { seat: result.seat, email: result.email, name: result.name },
    });

    return { ok: true, message: `Seat ${result.seat} now reads ${result.name}.` };
  } catch (err) {
    recordError('compPasses.rename', err);
    return { ok: false, error: 'Could not update the name.' };
  }
}
