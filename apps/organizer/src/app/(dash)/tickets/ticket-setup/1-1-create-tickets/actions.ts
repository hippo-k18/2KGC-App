'use server';

import { revalidatePath } from 'next/cache';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID } from '@kgc/shared';
import { appendAudit, diff } from '@/lib/audit';
import { requireOrganizer } from '@/lib/auth';
import { getTicketType } from '@/lib/commerce';
import { db } from '@/lib/firestore';
import { recordError } from '@/lib/errors';
import { ROUTES } from '@/lib/nav';

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

/** An empty string means "no date"; anything else must actually parse. */
function parseDate(raw: string): Timestamp | null | undefined {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : Timestamp.fromDate(d);
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
  const currency = String(formData.get('currency') ?? 'usd').trim().toLowerCase();
  const capacityRaw = String(formData.get('capacity') ?? '').trim();
  const sortOrder = Number(formData.get('sortOrder') ?? 0);
  const visible = formData.get('visible') === 'on';
  const inPerson = formData.get('inPerson') === 'on';
  const featured = formData.get('featured') === 'on';
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

  const salesOpenAt = parseDate(opensRaw);
  const salesCloseAt = parseDate(closesRaw);
  if (salesOpenAt === undefined || salesCloseAt === undefined) {
    return { error: 'Sales dates must be valid, or blank.' };
  }
  if (salesOpenAt && salesCloseAt && salesOpenAt.toMillis() >= salesCloseAt.toMillis()) {
    return { error: 'Sales must open before they close.' };
  }

  const includes = includesRaw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

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
    inPerson,
    featured,
    visible,
    sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
    audience: 'attendee' as const,
    taxCode: existing?.taxCode ?? 'txcd_20030000',
    // Booleans the public site does not use yet but the model declares. Kept in
    // step with the tier's contents so they never contradict the bullet list.
    includesWorkshops: existing?.includesWorkshops ?? false,
    includesVideoLibrary: existing?.includesVideoLibrary ?? false,
    quantityTotal: capacity,
    salesOpenAt,
    salesCloseAt,
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

    const before = existing
      ? {
          name: existing.name,
          priceCents: existing.priceCents,
          visible: existing.visible,
          quantityTotal: existing.quantityTotal,
        }
      : {};

    const changed = diff(before as Record<string, unknown>, {
      name,
      priceCents,
      visible,
      quantityTotal: capacity,
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
