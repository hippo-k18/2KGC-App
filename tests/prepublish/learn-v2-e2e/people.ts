import { createHash } from 'node:crypto';

export const OWNER = 'owner@learn-v2.test';
/** Learn only: may open and use the Learn page editor and nothing else. */
export const LEARN = 'learn@learn-v2.test';
/** Agenda only: must be refused by every Learn page action. */
export const AGENDA = 'agenda@learn-v2.test';

export function ownerSessionId(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}
