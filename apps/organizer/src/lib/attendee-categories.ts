import 'server-only';

import { cache } from 'react';
import { FieldValue } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  EVENT_ID,
  applyCategoryEdit,
  applyTicketRule,
  categoryFromRule,
  resolveAttendeeCategories,
  resolveTicketRules,
  type AttendeeCategoryDef,
  type CategoryEdit,
  type RegistrationDoc,
  type TicketCategoryRule,
} from '@kgc/shared';
import { holdersToRelabel, holdersToUnlabel, type RuleTarget } from './attendee-categories-core';
import { appendAudit } from './audit';
import { db } from './firestore';
import { SETTINGS_KEYS, readSettings, saveSettings } from './settings';

/**
 * Attendee categories: the list, the ticket rule, and who is in what.
 *
 * The list and the rules are one bag, `settings/attendeeCategories`. A person's
 * category is on their **registration** (`categoryId`, `category`,
 * `categorySource`), which is what the badge sheet, the exports and the
 * holder's own phone all already read.
 *
 * ── Not a role, and not a claim ─────────────────────────────────────────────
 *
 * This screen was read-only for a year on the argument that assigning a
 * category means minting the `roles` claim. That is true of a *role*. A
 * category grants nothing, so there is nothing to mint: `roles` stays where it
 * is, minted by the sign-in and provisioning paths, and this writes a label.
 *
 * ── Every query is one equality filter ──────────────────────────────────────
 *
 * `where('categoryId', '==', id)` alone, with `eventId` checked in memory. A
 * second `where` would need a composite index the emulator does not enforce and
 * production does.
 */

export interface CategoryBag {
  categories: AttendeeCategoryDef[];
  ticketRules: TicketCategoryRule[];
}

export const attendeeCategories = cache(async function attendeeCategories(): Promise<CategoryBag> {
  const stored = await readSettings(SETTINGS_KEYS.attendeeCategories);
  const categories = resolveAttendeeCategories(stored.categories);
  return { categories, ticketRules: resolveTicketRules(stored.ticketRules, categories) };
});

type Result = { ok: true; message: string } | { ok: false; error: string };

const regs = () => db().collection(COLLECTIONS.registrations);

/** Commit updates in batches of 400, under Firestore's 500-write limit. */
async function updateAll(ids: string[], fields: Record<string, unknown>): Promise<void> {
  for (let i = 0; i < ids.length; i += 400) {
    const batch = db().batch();
    for (const id of ids.slice(i, i + 400)) {
      batch.update(regs().doc(id), { ...fields, updatedAt: FieldValue.serverTimestamp() });
    }
    await batch.commit();
  }
}

const CLEAR = {
  categoryId: FieldValue.delete(),
  category: FieldValue.delete(),
  categorySource: FieldValue.delete(),
};

async function holdersOf(categoryId: string): Promise<string[]> {
  const snap = await regs().where('categoryId', '==', categoryId).get();
  return snap.docs.filter((d) => d.data().eventId === EVENT_ID).map((d) => d.id);
}

/**
 * Add, rename or remove a category.
 *
 * A rename rewrites the name copied onto each holder's registration, because
 * that copy is what their phone prints. A removal clears the category from
 * everyone who held it and drops any ticket rule that named it.
 */
export async function editCategory(edit: CategoryEdit, actor: string): Promise<Result> {
  const bag = await attendeeCategories();
  const res = applyCategoryEdit(bag.categories, edit);
  if (!res.ok) return res;

  const ticketRules = resolveTicketRules(bag.ticketRules, res.categories);
  const saved = await saveSettings(
    SETTINGS_KEYS.attendeeCategories,
    { categories: res.categories, ticketRules },
    actor,
  );
  if (!saved.ok) return saved;

  if (edit.op === 'add') return { ok: true, message: `${edit.name.trim()} added.` };

  const holders = await holdersOf(edit.id);
  const people = `${holders.length} ${holders.length === 1 ? 'person' : 'people'}`;

  if (edit.op === 'rename') {
    const name = res.categories.find((c) => c.id === edit.id)?.name ?? edit.name.trim();
    await updateAll(holders, { category: name });
    return { ok: true, message: holders.length ? `Saved. ${people} now show as ${name}.` : 'Saved.' };
  }

  await updateAll(holders, CLEAR);
  return {
    ok: true,
    message: holders.length ? `Category removed. ${people} now have no category.` : 'Category removed.',
  };
}

/**
 * Put people in a category by hand, or take them out with an empty id.
 *
 * Marked `manual`, which is what stops the ticket rule from changing it back
 * the next time that person buys or is imported.
 */
export async function assignCategory(
  registrationIds: string[],
  categoryId: string,
  actor: string,
): Promise<Result> {
  const ids = [...new Set(registrationIds.filter(Boolean))];
  if (ids.length === 0) return { ok: false, error: 'Select at least one attendee.' };
  if (ids.length > 2000) return { ok: false, error: 'Select fewer than 2,000 attendees at a time.' };

  const { categories } = await attendeeCategories();
  const category = categoryId ? categories.find((c) => c.id === categoryId) : undefined;
  if (categoryId && !category) return { ok: false, error: 'That category no longer exists.' };

  const snaps = await db().getAll(...ids.map((id) => regs().doc(id)));
  const found = snaps.filter((s) => s.exists && (s.data() as RegistrationDoc).eventId === EVENT_ID);
  if (found.length === 0) return { ok: false, error: 'Those attendees are no longer on the list.' };

  await updateAll(
    found.map((s) => s.id),
    category
      ? { categoryId: category.id, category: category.name, categorySource: 'manual' }
      : // Cleared by hand is still a hand decision: the rule must not put it back.
        { categoryId: FieldValue.delete(), category: FieldValue.delete(), categorySource: 'manual' },
  );

  await appendAudit({
    actor,
    action: 'attendee.category',
    targetPath: COLLECTIONS.registrations,
    targetId: found.length === 1 ? found[0].id : `${found.length} registrations`,
    before: Object.fromEntries(found.map((s) => [s.id, (s.data() as RegistrationDoc).categoryId ?? null])),
    after: { categoryId: category?.id ?? null },
  });

  const who =
    found.length === 1
      ? ((found[0].data() as RegistrationDoc).name ?? (found[0].data() as RegistrationDoc).email)
      : `${found.length} attendees`;
  return {
    ok: true,
    message: category
      ? `${who} ${found.length === 1 ? 'is' : 'are'} now ${category.name}. It prints on the badge.`
      : `${who} ${found.length === 1 ? 'has' : 'have'} no category now.`,
  };
}

async function ruleTargets(): Promise<RuleTarget[]> {
  const snap = await regs().where('eventId', '==', EVENT_ID).get();
  return snap.docs.map((d) => {
    const r = d.data() as RegistrationDoc;
    return {
      id: d.id,
      ticketType: r.ticketType,
      status: r.status,
      categoryId: r.categoryId,
      categorySource: r.categorySource,
    };
  });
}

/**
 * Set or clear the category a ticket type maps to.
 *
 * New registrations pick the rule up in `ensureRegistration`. The people who
 * already hold that ticket are relabelled here, in the same save, so the rule
 * and the list never disagree. Anyone given a category by hand is left alone.
 */
export async function saveTicketRule(ticketType: string, categoryId: string, actor: string): Promise<Result> {
  const bag = await attendeeCategories();
  const res = applyTicketRule(bag.categories, bag.ticketRules, ticketType, categoryId);
  if (!res.ok) return res;

  const previous = categoryFromRule({}, bag.categories, bag.ticketRules, ticketType);
  const saved = await saveSettings(
    SETTINGS_KEYS.attendeeCategories,
    { categories: bag.categories, ticketRules: res.rules },
    actor,
  );
  if (!saved.ok) return saved;

  const targets = await ruleTargets();
  const label = ticketType.trim();

  if (!categoryId) {
    const ids = previous === 'keep' ? [] : holdersToUnlabel(targets, ticketType, previous.categoryId);
    await updateAll(ids, CLEAR);
    return {
      ok: true,
      message: `${label} no longer sets a category.${ids.length ? ` ${ids.length} cleared.` : ''}`,
    };
  }

  const category = bag.categories.find((c) => c.id === categoryId)!;
  const ids = holdersToRelabel(targets, ticketType, categoryId);
  await updateAll(ids, { categoryId, category: category.name, categorySource: 'ticket' });
  return {
    ok: true,
    message: `${label} now sets ${category.name}. ${ids.length} current ${ids.length === 1 ? 'holder' : 'holders'} updated.`,
  };
}

/**
 * Re-apply the rule to one registration whose ticket type just changed.
 * Returns the category name it moved to, if it moved.
 */
export async function applyRuleTo(rid: string, ticketType: string): Promise<string | undefined> {
  const snap = await regs().doc(rid).get();
  const reg = snap.data() as RegistrationDoc | undefined;
  if (!reg) return undefined;
  const { categories, ticketRules } = await attendeeCategories();
  const next = categoryFromRule(reg, categories, ticketRules, ticketType);
  if (next === 'keep' || next.categoryId === reg.categoryId) return undefined;
  await regs().doc(rid).update({ ...next, updatedAt: FieldValue.serverTimestamp() });
  return next.category;
}
