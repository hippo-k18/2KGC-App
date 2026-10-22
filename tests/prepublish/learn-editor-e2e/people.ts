import { createHash } from 'node:crypto';

export const OWNER = 'owner@learn-e2e.test';
export const MEMBERS = ['learn-a@learn-e2e.test', 'learn-b@learn-e2e.test', 'learn-c@learn-e2e.test'];

export function ownerSessionId(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}
