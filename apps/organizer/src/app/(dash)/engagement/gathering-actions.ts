'use server';

import { revalidatePath } from 'next/cache';
import type { GatheringDoc } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { placeAttendee, saveGathering, setGatheringStatus } from '@/lib/gatherings';

/**
 * Round tables and meeting slots.
 *
 * One set of actions for both, because they are one document with a `kind`.
 * The kind arrives as a hidden field and is validated here rather than trusted
 * — it decides which screen the result appears on.
 */

const KINDS: GatheringDoc['kind'][] = ['round-table', 'meeting-slot'];

const SCREEN: Record<GatheringDoc['kind'], string> = {
  'round-table': '/engagement/round-table',
  'meeting-slot': '/engagement/1-1-meeting-scheduler',
};

export interface GatheringState {
  ok?: boolean;
  message?: string;
  error?: string;
}

function kindOf(form: FormData): GatheringDoc['kind'] | undefined {
  const raw = String(form.get('kind') ?? '');
  return KINDS.includes(raw as GatheringDoc['kind']) ? (raw as GatheringDoc['kind']) : undefined;
}

export async function saveGatheringAction(
  _prev: GatheringState,
  form: FormData,
): Promise<GatheringState> {
  const actor = await requireOrganizer();

  const kind = kindOf(form);
  if (!kind) return { error: 'Unknown kind.' };

  const roomValue = String(form.get('roomId') ?? '');
  // The select carries `id|Name` so the denormalised room name comes from the
  // same choice as the id — a second lookup is a second chance to disagree.
  const [roomId = '', roomName = ''] = roomValue.split('|');

  const result = await saveGathering({
    id: String(form.get('id') ?? '').trim() || undefined,
    kind,
    title: String(form.get('title') ?? ''),
    host: String(form.get('host') ?? ''),
    roomId,
    roomName,
    day: String(form.get('day') ?? ''),
    startsAtLocal: String(form.get('startsAtLocal') ?? ''),
    endsAtLocal: String(form.get('endsAtLocal') ?? ''),
    capacity: Number(form.get('capacity') ?? 0),
    notes: String(form.get('notes') ?? ''),
    actor,
  });

  revalidatePath(SCREEN[kind]);
  return result.ok ? { ok: true, message: result.message } : { error: result.error };
}

export async function placeAttendeeAction(
  _prev: GatheringState,
  form: FormData,
): Promise<GatheringState> {
  const actor = await requireOrganizer();
  const kind = kindOf(form);
  if (!kind) return { error: 'Unknown kind.' };

  const result = await placeAttendee({
    id: String(form.get('id') ?? ''),
    name: String(form.get('name') ?? ''),
    actor,
  });

  revalidatePath(SCREEN[kind]);
  return result.ok ? { ok: true, message: result.message } : { error: result.error };
}

export async function removeAttendeeAction(form: FormData): Promise<void> {
  const actor = await requireOrganizer();
  const kind = kindOf(form);
  await placeAttendee({
    id: String(form.get('id') ?? ''),
    name: String(form.get('name') ?? ''),
    remove: true,
    actor,
  });
  if (kind) revalidatePath(SCREEN[kind]);
}

export async function setStatusAction(form: FormData): Promise<void> {
  const actor = await requireOrganizer();
  const kind = kindOf(form);
  const raw = String(form.get('status') ?? '');
  const status = (['planned', 'confirmed', 'cancelled'] as const).includes(
    raw as GatheringDoc['status'],
  )
    ? (raw as GatheringDoc['status'])
    : undefined;

  if (status) await setGatheringStatus({ id: String(form.get('id') ?? ''), status, actor });
  if (kind) revalidatePath(SCREEN[kind]);
}
