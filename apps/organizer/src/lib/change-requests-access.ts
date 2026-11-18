import type { TeamRole } from '@kgc/shared';
import { CHANGE_REQUESTS_PATH } from './change-requests-core';
import { canOpen } from './team-core';

/**
 * Who may open Tools › Change requests, a request and its screenshots (T428):
 * signed in, and holding a role that opens `tools/change-requests` (owners
 * only today). Apart from `change-requests-core.ts` because `team-core`
 * reaches `node:crypto` and the core is imported by the public form.
 * The screenshot route answers with these codes.
 */
export function listAccess(roles: readonly TeamRole[] | null): 200 | 401 | 403 {
  if (!roles) return 401;
  return canOpen(roles, CHANGE_REQUESTS_PATH) ? 200 : 403;
}
