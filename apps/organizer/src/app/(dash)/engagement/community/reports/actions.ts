'use server';

import { revalidatePath } from 'next/cache';
import { requireOrganizer } from '@/lib/auth';
import { recordError } from '@/lib/errors';
import { ROUTES } from '@/lib/nav';
import { resolveReports, type ReportDecision } from '@/lib/reports';

/**
 * Hide and close, keep and close, or reopen every report on one target.
 *
 * The decision comes whole from the form rather than toggling, for the reason
 * the Community Board's actions give: a toggle read off a stale page undoes the
 * thing the organizer meant to do.
 */
export async function resolveReportAction(formData: FormData): Promise<void> {
  const actor = await requireOrganizer();
  const targetKey = String(formData.get('targetKey') ?? '');
  const raw = String(formData.get('decision') ?? '');
  const decision: ReportDecision | null = raw === 'hide' || raw === 'keep' || raw === 'reopen' ? raw : null;
  if (!targetKey || !decision) return;

  try {
    const res = await resolveReports({ targetKey, decision, actor });
    if (!res.ok) recordError('reports.resolve', new Error(res.error));
  } catch (err) {
    recordError('reports.resolve', err);
  }
  revalidatePath(ROUTES.communityReports);
  revalidatePath(ROUTES.moderateBoard);
}
