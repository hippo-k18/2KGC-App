/**
 * Tests for the dashboard's role guard.
 *
 * `requireOrganizer()` in `apps/organizer/src/lib/auth.ts` is the one place a
 * team member's roles are enforced, and everything it decides comes from the
 * pure functions tested here: which paths a role opens, where it lands, and
 * who an address is. The Admin SDK behind
 * the dashboard bypasses `firestore.rules`, so there is no second boundary
 * underneath this one — a wrong answer here is a check-in volunteer reading
 * the order book.
 *
 * Each test is named after the guarantee it protects.
 *
 * Run with: npm test  (or npm run test:programme)
 */
import { describe, expect, it } from 'vitest';
import type { TeamRole } from '@kgc/shared';
import { NAV, allPaths } from '../../apps/organizer/src/lib/nav';
import {
  ROLE_LABELS,
  TEAM_ROLES,
  canExport,
  canOpen,
  canRunAction,
  homeFor,
  looksLikeEmail,
  memberIdFor,
  newNonce,
  normalisePath,
  parseRoles,
  screenOfBundle,
} from '../../apps/organizer/src/lib/team-core';

const EVERY_PATH = allPaths(NAV);
const LIMITED = TEAM_ROLES.filter((r) => r !== 'owner');

const CHECK_IN = 'attendees/check-in-and-checkout/check-in';
const ORDERS = 'tickets/orders-and-transactions/attendee-orders';
const ADMIN_SETTINGS = 'attendees/admin-settings';

describe('an owner', () => {
  it('opens every path in the nav tree', () => {
    for (const path of EVERY_PATH) expect(canOpen(['owner'], path)).toBe(true);
  });

  it('opens paths outside the tree too, including the root', () => {
    expect(canOpen(['owner'], '')).toBe(true);
    expect(canOpen(['owner'], '/messaging')).toBe(true);
  });

  it('lands on Basics, where sign-in went before roles existed', () => {
    expect(homeFor(['owner'])).toBe('/content/basics');
    expect(homeFor(['checkin', 'owner'])).toBe('/content/basics');
  });
});

describe('a check-in-only account', () => {
  const roles: TeamRole[] = ['checkin'];

  it('opens every check-in screen', () => {
    const screens = EVERY_PATH.filter((p) => p.startsWith('attendees/check-in-and-checkout/'));
    expect(screens.length).toBeGreaterThanOrEqual(5);
    for (const path of screens) expect(canOpen(roles, path)).toBe(true);
  });

  it('opens nothing else in the tree', () => {
    const open = EVERY_PATH.filter((p) => canOpen(roles, p));
    for (const path of open) expect(path.startsWith('attendees/check-in-and-checkout')).toBe(true);
  });

  it('cannot open the attendee list, the orders or the team screen', () => {
    expect(canOpen(roles, 'attendees/manage-attendees/attendees')).toBe(false);
    expect(canOpen(roles, ORDERS)).toBe(false);
    expect(canOpen(roles, ADMIN_SETTINGS)).toBe(false);
  });

  it('cannot open the section index above it, which lists every sibling', () => {
    expect(canOpen(roles, 'attendees')).toBe(false);
    expect(canOpen(roles, '')).toBe(false);
  });

  it('lands on Check-in after sign-in', () => {
    expect(homeFor(roles)).toBe(`/${CHECK_IN}`);
  });

  it('is not fooled by a path that merely starts with the same letters', () => {
    expect(canOpen(roles, 'attendees/check-in-and-checkout-archive')).toBe(false);
    expect(canOpen(roles, 'attendees/check-in-and-checkoutx/check-in')).toBe(false);
  });
});

describe('the other roles', () => {
  it('finance opens Tickets and Pay, and not Content or Check-in', () => {
    expect(canOpen(['finance'], ORDERS)).toBe(true);
    expect(canOpen(['finance'], 'pay/balance')).toBe(true);
    expect(canOpen(['finance'], 'content/basics')).toBe(false);
    expect(canOpen(['finance'], CHECK_IN)).toBe(false);
  });

  it('agenda opens Content, less the branches that belong to other roles', () => {
    expect(canOpen(['agenda'], 'content/agenda-center/session-manager')).toBe(true);
    expect(canOpen(['agenda'], 'content/agenda-center/session-manager/new')).toBe(true);
    expect(canOpen(['agenda'], 'content/speaker-center/speaker-manager')).toBe(true);
    expect(canOpen(['agenda'], 'content/sponsor-center/sponsor-manager')).toBe(false);
    expect(canOpen(['agenda'], 'content/exhibitor-center/exhibitor-manager')).toBe(false);
    expect(canOpen(['agenda'], 'content/call-for-speakers-abstracts/reviewers')).toBe(false);
    expect(canOpen(['agenda'], ORDERS)).toBe(false);
  });

  it('sponsors opens the sponsor and exhibitor screens wherever they are filed', () => {
    expect(canOpen(['sponsors'], 'content/sponsor-center/sponsor-tiering')).toBe(true);
    expect(canOpen(['sponsors'], 'content/exhibitor-center/exhibitor-manager')).toBe(true);
    expect(canOpen(['sponsors'], 'marketing/event-webpages/sponsor-webpage/sponsor-list')).toBe(true);
    expect(canOpen(['sponsors'], 'tickets/exhibitor-ticket-setup/2-3-booth-selection')).toBe(true);
    expect(canOpen(['sponsors'], 'content/agenda-center/session-manager')).toBe(false);
    // Money stays with finance, including the money sponsors paid.
    expect(canOpen(['sponsors'], 'tickets/orders-and-transactions/sponsor-orders')).toBe(false);
  });

  it('reviewer manager opens the call for speakers and nothing beside it', () => {
    expect(canOpen(['reviews'], 'content/call-for-speakers-abstracts')).toBe(true);
    expect(canOpen(['reviews'], 'content/call-for-speakers-abstracts/submissions/abc')).toBe(true);
    expect(canOpen(['reviews'], 'content/basics')).toBe(false);
  });

  it('two roles open the union of what each opens', () => {
    const roles: TeamRole[] = ['agenda', 'reviews'];
    expect(canOpen(roles, 'content/call-for-speakers-abstracts/reviewers')).toBe(true);
    expect(canOpen(roles, 'content/agenda-center/track-manager')).toBe(true);
    expect(canOpen(roles, 'content/sponsor-center/sponsor-manager')).toBe(false);
  });

  it('no limited role opens the team screen, the report or the attendee list', () => {
    for (const role of LIMITED) {
      expect(canOpen([role], ADMIN_SETTINGS)).toBe(false);
      expect(canOpen([role], 'tools/report')).toBe(false);
      expect(canOpen([role], 'attendees/manage-attendees/attendees')).toBe(false);
    }
  });

  it('every limited role can open the screen it lands on, so a redirect home cannot loop', () => {
    for (const role of LIMITED) {
      const home = homeFor([role]);
      expect(EVERY_PATH).toContain(normalisePath(home));
      expect(canOpen([role], home)).toBe(true);
    }
  });

  it('somebody who is also on the desk lands on their main job, not on Check-in', () => {
    expect(homeFor(['checkin', 'finance'])).toBe(`/${ORDERS}`);
  });

  it('no role at all opens nothing and is sent to sign-in', () => {
    expect(EVERY_PATH.filter((p) => canOpen([], p))).toEqual([]);
    expect(homeFor([])).toBe('/login');
  });

  it('a role name it has never heard of opens nothing', () => {
    expect(canOpen(['admin' as TeamRole], 'content/basics')).toBe(false);
  });

  it('every role has a label for the invite form', () => {
    for (const role of TEAM_ROLES) expect(ROLE_LABELS[role].label).toBeTruthy();
  });
});

describe('paths as a request presents them', () => {
  it('ignores the leading slash, a trailing slash and the query string', () => {
    expect(canOpen(['checkin'], `/${CHECK_IN}`)).toBe(true);
    expect(canOpen(['checkin'], `/${CHECK_IN}/?list=main`)).toBe(true);
    expect(normalisePath('/tickets/orders/?x=1#top')).toBe('tickets/orders');
  });

  it('does not let a query string smuggle in an allowed prefix', () => {
    expect(canOpen(['checkin'], `/tickets/orders?next=/${CHECK_IN}`)).toBe(false);
  });
});

describe('server actions', () => {
  const CHECK_IN_PAGE = 'app/(dash)/attendees/check-in-and-checkout/check-in/page';
  const ORDERS_PAGE = 'app/(dash)/tickets/orders-and-transactions/attendee-orders/page';
  const TEAM_PAGE = 'app/(dash)/attendees/admin-settings/page';

  it('reads a page bundle name as the screen it serves', () => {
    expect(screenOfBundle(CHECK_IN_PAGE)).toBe(CHECK_IN);
    expect(screenOfBundle('app/(dash)/content/call-for-speakers-abstracts/submissions/[id]/page')).toBe(
      'content/call-for-speakers-abstracts/submissions/[id]',
    );
    expect(screenOfBundle('app/login/page')).toBe('login');
    expect(screenOfBundle('app/export/[kind]/route')).toBe('export/[kind]');
  });

  it('a check-in account runs an action its own screen imports', () => {
    expect(canRunAction(['checkin'], [CHECK_IN_PAGE])).toBe(true);
  });

  it('a check-in account cannot run the refund action by posting it somewhere it may open', () => {
    // The request path is not an input here at all, which is the guarantee:
    // only the screens that import the action count.
    expect(canRunAction(['checkin'], [ORDERS_PAGE])).toBe(false);
    expect(canRunAction(['checkin'], [TEAM_PAGE])).toBe(false);
  });

  it('an action shared by several screens runs for a role that opens any one of them', () => {
    // Sign-out is imported by the layout, so by every screen.
    expect(canRunAction(['checkin'], [ORDERS_PAGE, TEAM_PAGE, CHECK_IN_PAGE])).toBe(true);
    expect(canRunAction(['finance'], [ORDERS_PAGE, TEAM_PAGE])).toBe(true);
  });

  it('an action no known screen imports is refused to everybody but an owner', () => {
    for (const role of LIMITED) expect(canRunAction([role], [])).toBe(false);
    expect(canRunAction(['owner'], [])).toBe(true);
  });

  it('the catch-all screen opens nothing for a limited role', () => {
    expect(canRunAction(['agenda'], ['app/(dash)/[...slug]/page'])).toBe(false);
  });
});

describe('exports', () => {
  it('an owner downloads anything', () => {
    expect(canExport(['owner'], 'attendees')).toBe(true);
    expect(canExport(['owner'], 'a-kind-added-next-year')).toBe(true);
  });

  it('follows the role that owns the screen the file comes from', () => {
    expect(canExport(['finance'], 'orders')).toBe(true);
    expect(canExport(['agenda'], 'sessions')).toBe(true);
    expect(canExport(['sponsors'], 'sponsors')).toBe(true);
    expect(canExport(['checkin'], 'checked-in')).toBe(true);
  });

  it('keeps the attendee list, and any kind nobody mapped, to owners', () => {
    for (const role of LIMITED) {
      expect(canExport([role], 'attendees')).toBe(false);
      expect(canExport([role], 'a-kind-added-next-year')).toBe(false);
    }
    expect(canExport(['checkin'], 'orders')).toBe(false);
  });
});

describe('parseRoles', () => {
  it('keeps real roles once each, in a fixed order, and drops the rest', () => {
    expect(parseRoles(['reviews', 'finance', 'finance', 'root'])).toEqual(['finance', 'reviews']);
    expect(parseRoles('finance')).toEqual([]);
    expect(parseRoles(undefined)).toEqual([]);
  });
});

describe('who an address is', () => {
  it('is one team document per person, whatever the case they typed', () => {
    expect(memberIdFor('Ada@Example.com')).toBe(memberIdFor(' ada@example.com '));
    expect(memberIdFor('ada@example.com')).not.toBe(memberIdFor('bob@example.com'));
  });
  it('accepts an address and refuses a bare word', () => {
    expect(looksLikeEmail('ada@example.com')).toBe(true);
    expect(looksLikeEmail('ada')).toBe(false);
  });
  it('mints a fresh session epoch every time', () => {
    expect(newNonce()).not.toBe(newNonce());
  });
});
