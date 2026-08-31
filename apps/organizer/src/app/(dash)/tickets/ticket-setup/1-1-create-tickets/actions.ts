'use server';

import { revalidatePath } from 'next/cache';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, TIME_ZONE, type TicketAudience } from '@kgc/shared';
import { appendAudit, diff } from '@/lib/audit';
import { requireOrganizer } from '@/lib/auth';
import { getTicketType } from '@/lib/commerce';
import { db } from '@/lib/firestore';
import { recordError } from '@/lib/errors';
import { ROUTES } from '@/lib/nav';
import { fromWallClock, isWallClock } from '@/lib/time';
import { groupsToText, parseGroups } from './groups';

/**
 * Creating and editing ticket types.
 *
 * ── This screen sets prices, so it is a money screen ────────────────────────
 *
 * `ticketTypes` is what the website charges against — `startCheckout` reads a
 * tier by id and hands its `priceCents` straight to Stripe. A typo here is not
 * a display bug; it is the amount a buyer's card is charged. Two consequences:
 *
 *   **Prices are entered in whole currency units and stored in minor units.**
 *   An organizer types `799`, Firestore holds `79900`. Asking a human to type
 *   cents is how a ticket ends up costing $799.00 or $7.99 depending on who
 *   filled the form in.
 *
 *   **Every change is audited with a before and after.** "Who changed the price
 *   of the workshop ticket, and to what?" needs an answer that is not "check
 *   the git history of a database".
 *
 * ── Editing a price does not change what anyone already paid ────────────────
 *
 * Orders record their own amounts (`OrderDoc.totalCents`, `OrderLine.
 * unitPriceCents`), so past sales are unaffected by an edit here. That is why
 * the order document denormalises the ticket name too — renaming a tier must
 * not rewrite history.
 */

export interface TicketState {
  ok?: boolean;
  message?: string;
  error?: string;
}

/** URL-safe, readable, and stable enough to live in Stripe metadata. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 48);
}

/**
 * `"799"`, `"799.00"`, `"$1,199"` → cents.
 *
 * Returns null rather than NaN or 0 for anything unparseable. A price that
 * silently becomes zero is a ticket that is silently free.
 */
function parseMoney(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const cents = Math.round(Number(cleaned) * 100);
  return Number.isFinite(cents) ? cents : null;
}

/**
 * An empty string means "no date"; anything else is wall clock in the event's
 * zone and must actually parse.
 *
 * ── The zone is not the server's ────────────────────────────────────────────
 *
 * This was `new Date(raw)`, which resolves a `datetime-local` value in whatever
 * zone the *process* happens to run in. On a laptop in New York that is right
 * by accident. On Netlify, which builds and runs in UTC, an early-bird deadline
 * typed as `23:59` closes at 19:59 Eastern — four hours of sales gone on the
 * busiest day, with every screen still printing "closes 23:59" because it
 * formats the same instant back through the same wrong zone.
 *
 * Sessions solved this first and this follows their precedent exactly: the wall
 * clock is the authoring truth, the instant is derived from it server-side
 * through the one shared implementation, and both are stored — see
 * `scripts/src/lib/time.ts`.
 */
function parseSalesDate(local: string): Timestamp | null | undefined {
  if (!local) return null;
  if (!isWallClock(local)) return undefined;
  try {
    return fromWallClock(local, TIME_ZONE);
  } catch {
    return undefined;
  }
}

/**
 * Some browsers post `datetime-local` with seconds. Trimming them is not the
 * same as accepting a loose format — anything that is not wall clock after the
 * trim is still refused by `parseSalesDate`, because an ISO instant with an
 * offset in this box would mean the zone arrived twice and disagreed with
 * itself.
 */
function normaliseWallClock(raw: string): string {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(raw) ? raw.slice(0, 16) : raw;
}

export async function saveTicketTypeAction(
  _prev: TicketState,
  formData: FormData,
): Promise<TicketState> {
  const actor = await requireOrganizer();

  const id = String(formData.get('id') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const priceRaw = String(formData.get('price') ?? '').trim();
  const tagline = String(formData.get('tagline') ?? '').trim();
  const includesRaw = String(formData.get('includes') ?? '');
  const groupsRaw = String(formData.get('groups') ?? '');
  const currency = String(formData.get('currency') ?? 'usd').trim().toLowerCase();
  const capacityRaw = String(formData.get('capacity') ?? '').trim();
  const sortOrder = Number(formData.get('sortOrder') ?? 0);
  const visible = formData.get('visible') === 'on';
  const inPerson = formData.get('inPerson') === 'on';
  const featured = formData.get('featured') === 'on';
  const audienceRaw = String(formData.get('audience') ?? '');
  const audience: TicketAudience = (['attendee', 'exhibitor', 'sponsor'] as const).includes(
    audienceRaw as TicketAudience,
  )
    ? (audienceRaw as TicketAudience)
    : 'attendee';
  const includesWorkshops = formData.get('includesWorkshops') === 'on';
  const includesVideoLibrary = formData.get('includesVideoLibrary') === 'on';
  const opensRaw = String(formData.get('salesOpenAt') ?? '').trim();
  const closesRaw = String(formData.get('salesCloseAt') ?? '').trim();

  if (name.length < 2) return { error: 'Give the ticket a name — it prints on the badge.' };

  const priceCents = parseMoney(priceRaw);
  if (priceCents === null) {
    return { error: 'Price must be a number like 799 or 799.00. Enter dollars, not cents.' };
  }
  if (priceCents === 0 && visible) {
    // Allowed, but only deliberately: a $0 tier that is also publicly visible is
    // almost always a typo rather than a comp rate someone meant to publish.
    return {
      error:
        'A free ticket cannot be publicly visible — untick "Show on the website" if you meant a comp rate.',
    };
  }
  if (!/^[a-z]{3}$/.test(currency)) return { error: 'Currency must be a three-letter code.' };

  const capacity = capacityRaw === '' ? undefined : Number(capacityRaw);
  if (capacity !== undefined && (!Number.isInteger(capacity) || capacity < 1)) {
    return { error: 'Capacity must be a whole number, or blank for unlimited.' };
  }

  // Normalised first, so the stored wall clock and the derived instant are two
  // views of one string rather than two parses of the raw form value.
  const opensLocal = normaliseWallClock(opensRaw);
  const closesLocal = normaliseWallClock(closesRaw);
  const salesOpenAt = parseSalesDate(opensLocal);
  const salesCloseAt = parseSalesDate(closesLocal);
  if (salesOpenAt === undefined || salesCloseAt === undefined) {
    return { error: 'Sales dates must be valid, or blank. Use the date picker.' };
  }
  if (salesOpenAt && salesCloseAt && salesOpenAt.toMillis() >= salesCloseAt.toMillis()) {
    return { error: 'Sales must open before they close.' };
  }

  const includes = includesRaw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const groups = parseGroups(groupsRaw);
  if (groups === null) {
    return {
      error:
        'The grouped list starts with a bullet. Put a heading above it — a line with no dash — or leave the box empty.',
    };
  }

  const docId = id || slugify(name);
  if (!docId) return { error: 'That name produces an empty id. Use some letters or numbers.' };

  const existing = id ? await getTicketType(id) : null;
  if (!id) {
    // Creating: refuse to land on an occupied id rather than silently
    // overwriting a live ticket type because two of them slugify the same.
    const clash = await getTicketType(docId);
    if (clash) {
      return { error: `A ticket type called "${clash.name}" already uses the id "${docId}".` };
    }
  }

  const fields = {
    name,
    priceCents,
    currency,
    tagline,
    includes,
    /**
     * The list the public tickets page actually renders.
     *
     * `apps/web/src/app/tickets/page.tsx` prefers `groups` and falls back to
     * `includes`, and both headline tiers carry a `groups` from the seed — so
     * until this field was written here, editing "What's included" for All
     * Access or Main Conference changed the checkout order rail and nothing a
     * buyer reads on the panel. An empty array is written deliberately rather
     * than omitted: it is how an organizer says "just use the flat list", and
     * the `merge: true` write would otherwise preserve a `groups` they had
     * just cleared.
     */
    groups,
    inPerson,
    featured,
    visible,
    sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
    /**
     * Preserved, never assumed.
     *
     * This wrote `'attendee'` unconditionally, which meant opening an exhibitor
     * or sponsor tier in this form and pressing Save **silently moved it into
     * the attendee catalogue** — with nothing on screen saying so, and the tier
     * then appearing on the public tickets page. The form now carries the
     * field, and an edit keeps whatever the tier already was.
     */
    audience,
    taxCode: existing?.taxCode ?? 'txcd_20030000',
    /**
     * Entitlement booleans, now actually editable.
     *
     * These were carried forward from the existing document and defaulted to
     * `false` on create, with a comment claiming the public site did not use
     * them. Both halves were wrong: `attendees/ticket-session-mapping` derives
     * workshop access from `includesWorkshops`, and defaulting on create meant
     * **a tier created from this dashboard could never grant workshop access at
     * all** — the flag arrived only from `npm run seed`. An organizer would have
     * had no way to sell a workshop ticket, and nothing on screen would have
     * said why.
     */
    includesWorkshops,
    includesVideoLibrary,
    quantityTotal: capacity,
    salesOpenAt,
    salesCloseAt,
    /**
     * The wall clock is the authoring truth; the two `Timestamp`s above are
     * derived from it. Stored so that reopening the form shows the hour that
     * was typed rather than the same instant re-rendered in whatever zone the
     * reader's server is in, and so that the derivation can be redone if the
     * event ever moves zone.
     */
    salesOpenAtLocal: opensLocal || null,
    salesCloseAtLocal: closesLocal || null,
    salesTimeZone: TIME_ZONE,
  };

  try {
    const ref = db().collection(COLLECTIONS.ticketTypes).doc(docId);

    await ref.set(
      {
        ...fields,
        eventId: EVENT_ID,
        /**
         * Never written on an update.
         *
         * `quantitySold` counts real purchases. Resetting it while editing a
         * tagline would make a sold-out tier look open, and the way that
         * failure surfaces is overselling a room.
         */
        ...(existing ? {} : { quantitySold: 0 }),
        ...(existing ? {} : { createdAt: FieldValue.serverTimestamp() }),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    /**
     * What the audit compares.
     *
     * The price and the cap were always here, and they are the entries anybody
     * goes looking for. The *copy* fields were added when `groups` became
     * editable: an edit to what a ticket includes is a change to what was sold,
     * and "the website said this ticket included the workshops when I bought
     * it" is a dispute the log has to be able to settle. Both lists are
     * flattened to text so the entry reads at a glance rather than as nested
     * JSON.
     */
    const before = existing
      ? {
          name: existing.name,
          priceCents: existing.priceCents,
          visible: existing.visible,
          quantityTotal: existing.quantityTotal,
          tagline: existing.tagline,
          includes: (existing.includes ?? []).join(' · '),
          groups: groupsToText(
            (existing.groups ?? []).map((g) => ({ heading: g.heading, items: g.items ?? [] })),
          ),
          includesWorkshops: existing.includesWorkshops === true,
          includesVideoLibrary: existing.includesVideoLibrary === true,
          salesOpenAtLocal: existing.salesOpenAtLocal ?? null,
          salesCloseAtLocal: existing.salesCloseAtLocal ?? null,
        }
      : {};

    const changed = diff(before as Record<string, unknown>, {
      name,
      priceCents,
      visible,
      quantityTotal: capacity,
      tagline,
      includes: includes.join(' · '),
      groups: groupsToText(groups),
      includesWorkshops,
      includesVideoLibrary,
      salesOpenAtLocal: opensLocal || null,
      salesCloseAtLocal: closesLocal || null,
    });

    await appendAudit({
      actor,
      action: existing ? 'ticketType.update' : 'ticketType.create',
      targetPath: `${COLLECTIONS.ticketTypes}/${docId}`,
      targetId: docId,
      before: changed.before,
      after: changed.after,
    });

    revalidatePath(ROUTES.createTickets);
    revalidatePath(ROUTES.ordersSummary);

    return {
      ok: true,
      message: existing
        ? `Saved. The website shows the new details immediately${
            changed.changed.includes('priceCents')
              ? ' — including the new price, which applies to purchases from now on.'
              : '.'
          }`
        : `Created "${name}" as ${docId}. It is ${visible ? 'live on the website now' : 'hidden — tick "Show on the website" when you are ready'}.`,
    };
  } catch (err) {
    recordError('ticketType.save', err);
    return { error: err instanceof Error ? err.message : 'Could not save the ticket type.' };
  }
}

/**
 * Correct `quantitySold` by hand.
 *
 * ── Why a tier needs this at all ────────────────────────────────────────────
 *
 * `quantitySold` is incremented at fulfilment and **never decremented on
 * refund** — that is written into the model and it is a deliberate
 * simplification, because the increment must never be allowed to fail a sale.
 * The cost is a one-way ratchet: ten refunds permanently consume ten seats of a
 * capped tier, and until this existed the only remedy was to inflate
 * `quantityTotal`, which then lied on every "12 / 16 sold" readout on the
 * dashboard. Both writers also swallow their own failures, so the counter can
 * drift low as well as high.
 *
 * The screen offers the ledger's own figure — recomputed from `orders` through
 * the same fold the reconcile script uses — so this is a confirmation rather
 * than a guess. `npm run reconcile:sold` does the whole catalogue at once.
 *
 * ── Why it is not folded into the save action ───────────────────────────────
 *
 * `saveTicketTypeAction` refuses to write this field, deliberately: resetting
 * the sold count while editing a tagline would make a sold-out tier look open,
 * and the way that failure surfaces is overselling a room. So it is a separate
 * action, with its own audit verb, its own typed confirmation and a required
 * reason — the one place in the product where somebody rewrites the record of
 * what has already been bought.
 */
export async function adjustSoldCountAction(
  _prev: TicketState,
  formData: FormData,
): Promise<TicketState> {
  const actor = await requireOrganizer();

  const id = String(formData.get('id') ?? '').trim();
  const soldRaw = String(formData.get('sold') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();

  if (!id) return { error: 'No ticket type was named.' };

  const sold = Number(soldRaw);
  if (soldRaw === '' || !Number.isInteger(sold) || sold < 0) {
    return { error: 'The sold count must be a whole number, and cannot be negative.' };
  }

  // Required, and required to be a sentence. This is the audit entry somebody
  // reads a year later; "0" or "fix" answers nothing.
  if (reason.length < 8) {
    return { error: 'Say why in a few words — it is the only record of this correction.' };
  }

  const existing = await getTicketType(id);
  if (!existing) return { error: `No ticket type with the id "${id}".` };

  const was = existing.quantitySold ?? 0;
  if (was === sold) return { error: `That is already the count — ${sold} sold.` };

  try {
    await db()
      .collection(COLLECTIONS.ticketTypes)
      .doc(id)
      .update({ quantitySold: sold, updatedAt: FieldValue.serverTimestamp() });

    await appendAudit({
      actor,
      action: 'ticketType.adjustSold',
      targetPath: `${COLLECTIONS.ticketTypes}/${id}`,
      targetId: id,
      before: { quantitySold: was },
      after: { quantitySold: sold, reason },
    });
  } catch (err) {
    recordError('ticketType.adjustSold', err);
    return { error: err instanceof Error ? err.message : 'Could not adjust the sold count.' };
  }

  revalidatePath(ROUTES.createTickets);
  revalidatePath(ROUTES.ordersSummary);

  const cap = existing.quantityTotal;
  return {
    ok: true,
    message:
      `${existing.name} now reads ${sold} sold, was ${was}.` +
      (cap === undefined
        ? ' This tier is uncapped, so the figure is a readout rather than a gate.'
        : sold >= cap
          ? ` That is at or over the cap of ${cap} — the tier is closed on the website.`
          : ` ${cap - sold} of ${cap} still on sale.`),
  };
}

/**
 * Hide or show a tier without opening the editor.
 *
 * There is no delete, deliberately. Orders reference a `ticketTypeId`, and a
 * deleted tier turns every one of those into a dangling pointer — while hiding
 * achieves the only thing anyone actually wants (stop selling it) and keeps the
 * ledger readable. If a tier really must go, it can be deleted in the Firebase
 * console by somebody who has thought about the orders.
 */
export async function toggleTicketVisibilityAction(formData: FormData): Promise<void> {
  const actor = await requireOrganizer();
  const id = String(formData.get('id') ?? '').trim();
  if (!id) return;

  const existing = await getTicketType(id);
  if (!existing) return;

  const next = !(existing.visible !== false);

  try {
    await db()
      .collection(COLLECTIONS.ticketTypes)
      .doc(id)
      .update({ visible: next, updatedAt: FieldValue.serverTimestamp() });

    await appendAudit({
      actor,
      action: 'ticketType.update',
      targetPath: `${COLLECTIONS.ticketTypes}/${id}`,
      targetId: id,
      before: { visible: existing.visible !== false },
      after: { visible: next },
    });
  } catch (err) {
    recordError('ticketType.toggleVisibility', err);
  }

  revalidatePath(ROUTES.createTickets);
}
