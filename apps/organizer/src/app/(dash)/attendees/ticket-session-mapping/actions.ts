'use server';

import { revalidatePath } from 'next/cache';
import { COLLECTIONS } from '@kgc/shared';
import { appendAudit } from '@/lib/audit';
import { requireOrganizer } from '@/lib/auth';
import { listTicketEntitlements } from '@/lib/cohorts';
import { listSessions } from '@/lib/data';
import { recordError } from '@/lib/errors';
import { ROUTES } from '@/lib/nav';
import { setEligibleTicketTypes } from '@/lib/session-seats';
import { joinNames, resolveEligibility } from '@/lib/session-seats-core';
import type { FormState } from '../../form';

function revalidate() {
  revalidatePath('/attendees/ticket-session-mapping');
  revalidatePath('/attendees/session-cap');
  revalidatePath(ROUTES.sessionManager, 'layout');
}

async function restrict(sessionId: string, names: string[], actor: string) {
  const out = await setEligibleTicketTypes(sessionId, names);
  if (!out.ok) return out;
  await appendAudit({
    actor,
    action: 'session.update',
    targetPath: `${COLLECTIONS.sessions}/${sessionId}`,
    targetId: sessionId,
    before: { eligibleTicketTypes: out.before },
    after: { eligibleTicketTypes: names },
  });
  return out;
}

/**
 * Limit one session to the ticked ticket types. Nothing ticked opens it to
 * every ticket. The app and the rules read the list from the session, so it
 * applies to the next person who tries to add it.
 */
export async function saveEligibilityAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireOrganizer();
  const sessionId = String(formData.get('sessionId') ?? '');
  if (!sessionId) return { fieldErrors: { sessionId: 'Pick a session.' }, error: 'Pick a session.' };

  try {
    const tiers = await listTicketEntitlements();
    const names = resolveEligibility(
      formData.getAll('tickets').map(String),
      tiers.map((t) => t.name),
    );
    const out = await restrict(sessionId, names, actor);
    if (!out.ok) return { error: out.error };
    revalidate();
    return {
      ok: true,
      message: names.length
        ? `${out.title} is now for ${joinNames(names)} tickets only.`
        : `${out.title} is open to every ticket.`,
    };
  } catch (err) {
    recordError(`sessionSeats.eligibility ${sessionId}`, err);
    return { error: 'That could not be saved. Try again.' };
  }
}

/**
 * Limit every workshop to the ticket types that include workshops, in one go.
 * This is what makes the "includes workshops" switch on a ticket type take
 * effect: until it is applied, that switch is a line on the tickets page.
 */
export async function restrictWorkshopsAction(_prev: FormState, _formData: FormData): Promise<FormState> {
  const actor = await requireOrganizer();
  try {
    const [tiers, sessions] = await Promise.all([listTicketEntitlements(), listSessions()]);
    const names = tiers.filter((t) => t.includesWorkshops).map((t) => t.name);
    if (names.length === 0) {
      return { error: 'No ticket type includes workshops yet. Set that in Ticket Setup first.' };
    }
    const workshops = sessions.filter((s) => s.format === 'workshop' && s.status !== 'cancelled');
    if (workshops.length === 0) return { error: 'There are no workshops in the programme.' };

    for (const s of workshops) await restrict(s.id, names, actor);
    revalidate();
    return {
      ok: true,
      message: `${workshops.length} workshops are now for ${joinNames(names)} tickets only.`,
    };
  } catch (err) {
    recordError('sessionSeats.restrictWorkshops', err);
    return { error: 'That could not be saved. Try again.' };
  }
}
