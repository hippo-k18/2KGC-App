import 'server-only';

import type { HubspotTrigger } from '@kgc/shared';
import { queueAndKickHubspot } from '@kgc/scripts/src/lib/hubspot-sync';
import { db } from './firestore';
import { recordError } from './errors';

/**
 * Tell the HubSpot sync (T333) that these registrations changed. Called after
 * the change has been written. Queues them and starts a send without waiting
 * for it; does nothing when the sync is off. Never throws, so a HubSpot
 * problem can never fail the action that called it.
 */
export async function kickHubspot(registrationIds: readonly string[], trigger: HubspotTrigger): Promise<void> {
  try {
    await queueAndKickHubspot(db(), registrationIds.filter(Boolean), trigger, recordError);
  } catch (err) {
    recordError('hubspot trigger failed', err);
  }
}
