'use server';

import { requireOrganizer } from '@/lib/auth';
import { recordError } from '@/lib/errors';
import { db } from '@/lib/firestore';
import { readSendJob, type SendJobView } from '@/lib/send-jobs';

/**
 * The progress of one background bulk send, for `SendProgress` to poll.
 *
 * Read-only, and only counts and the subject line: no addresses leave here.
 */
export async function readSendJobAction(campaignId: string): Promise<SendJobView | null> {
  await requireOrganizer();
  if (!/^[a-z]+_[0-9a-f]{32}$/.test(campaignId)) return null;
  try {
    return await readSendJob(db(), campaignId);
  } catch (err) {
    recordError('sendJob.read', err);
    return null;
  }
}
