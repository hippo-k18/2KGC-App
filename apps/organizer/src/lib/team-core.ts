import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { TeamRole } from '@kgc/shared';

/**
 * Team access: which role opens which screen, and the two secrets a member
 * holds — a passphrase and, once, a link to set it.
 *
 * Pure, so `tests/programme/team-core.test.ts` can pin it. `lib/auth.ts` is the
 * only caller that decides anything from `canOpen()`; `lib/team.ts` owns the
 * documents. Nothing here reads Firestore, a cookie or the environment.
 *
 * ── Why access is decided from the path ─────────────────────────────────────
 *
 * The dashboard has some 170 screens and over 200 server actions, and every one
 * of them already starts with `requireOrganizer()`. A role check that had to be
 * written into each would be forgotten in the one that mattered. So the guard
 * asks a single question — may this person open this screen — of the path a
 * page request was made to, and of the screens that import a server action
 * (`canRunAction`). The tree in `nav.ts` is the map of areas; a role is a set
 * of branches.
 *
 * ⚠️ Anything not named below belongs to owners alone. A new screen is closed
 * to every other role until somebody decides otherwise, which is the right way
 * round for a list like this to fail.
 */

export const TEAM_ROLES: readonly TeamRole[] = [
  'owner',
  'finance',
  'agenda',
  'sponsors',
  'checkin',
  'reviews',
];

/** The name an owner reads when ticking a box, and what the box opens. */
export const ROLE_LABELS: Record<TeamRole, { label: string; covers: string }> = {
  owner: { label: 'Owner', covers: 'Everything, including this screen' },
  finance: { label: 'Finance', covers: 'Tickets and Pay' },
  agenda: { label: 'Agenda', covers: 'Content, except sponsors, exhibitors and the call for speakers' },
  sponsors: { label: 'Sponsors', covers: 'Sponsor and exhibitor screens' },
  checkin: { label: 'Check-in only', covers: 'Check-in & Checkout and nothing else' },
  reviews: { label: 'Reviewer manager', covers: 'Call For Speakers/Abstracts' },
};

interface RoleRule {
  /** Path prefixes, in `nav.ts` form: no leading slash. */
  allow: string[];
  /** Branches inside an allowed prefix that belong to another role. */
  except?: string[];
  /** Where this role lands after sign-in. Must be inside `allow`. */
  home: string;
}

const SPONSOR_BRANCHES = ['content/sponsor-center', 'content/exhibitor-center'];
const REVIEW_BRANCH = 'content/call-for-speakers-abstracts';

const RULES: Record<Exclude<TeamRole, 'owner'>, RoleRule> = {
  finance: {
    allow: ['tickets', 'pay'],
    home: 'tickets/orders-and-transactions/attendee-orders',
  },
  agenda: {
    allow: ['content'],
    except: [...SPONSOR_BRANCHES, REVIEW_BRANCH],
    home: 'content/agenda-center/session-manager',
  },
  sponsors: {
    allow: [
      ...SPONSOR_BRANCHES,
      'marketing/event-webpages/sponsor-webpage',
      'marketing/event-webpages/exhibitor-webpage',
      'tickets/exhibitor-ticket-setup',
      'tickets/sponsor-ticket-setup',
    ],
    home: 'content/sponsor-center/sponsor-manager',
  },
  checkin: {
    allow: ['attendees/check-in-and-checkout'],
    home: 'attendees/check-in-and-checkout/check-in',
  },
  reviews: {
    allow: [REVIEW_BRANCH],
    home: REVIEW_BRANCH,
  },
};

/** Where an owner lands, and where sign-in always went before roles existed. */
const OWNER_HOME = 'content/basics';

/**
 * When a member holds several roles, the first of these they hold picks the
 * landing screen. Check-in is last on purpose: somebody who is *also* on the
 * desk should land on their main job, and somebody who is only on the desk has
 * no other entry to land on.
 */
const HOME_ORDER: Exclude<TeamRole, 'owner'>[] = ['finance', 'agenda', 'sponsors', 'reviews', 'checkin'];

/** Keeps only real role names, once each, in `TEAM_ROLES` order. */
export function parseRoles(raw: unknown): TeamRole[] {
  const given = Array.isArray(raw) ? raw.map(String) : [];
  return TEAM_ROLES.filter((r) => given.includes(r));
}

/** `/tickets/orders/?x=1` and `tickets/orders` are the same screen. */
export function normalisePath(path: string): string {
  return path.split(/[?#]/)[0].replace(/^\/+|\/+$/g, '');
}

function within(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * May somebody holding `roles` open `path`?
 *
 * A section header such as `attendees` is not opened by holding one screen
 * beneath it: its index lists every sibling, and the point of a check-in-only
 * account is that it does not learn what else exists.
 */
export function canOpen(roles: readonly TeamRole[], path: string): boolean {
  if (roles.includes('owner')) return true;
  const p = normalisePath(path);
  return roles.some((role) => {
    const rule = RULES[role as Exclude<TeamRole, 'owner'>];
    if (!rule) return false;
    if (!rule.allow.some((prefix) => within(p, prefix))) return false;
    return !(rule.except ?? []).some((prefix) => within(p, prefix));
  });
}

/**
 * The screen behind one of Next's page bundle names:
 * `app/(dash)/tickets/orders/[id]/page` is `tickets/orders/[id]`. Route groups
 * are not part of a URL, and a dynamic segment stays as written, which is
 * harmless because access is decided by prefix.
 */
export function screenOfBundle(bundle: string): string {
  return bundle
    .split('/')
    .filter((part, i, all) => {
      if (i === 0 && part === 'app') return false;
      if (i === all.length - 1 && (part === 'page' || part === 'route')) return false;
      return !/^\(.*\)$/.test(part);
    })
    .join('/');
}

/**
 * May somebody holding `roles` run a server action that `bundles` import?
 *
 * A server action is addressed by an id, not by a URL: it can be posted at any
 * screen and Next will find it and run it. So the path a request was made to
 * says nothing about which action it carries, and a check-in account could post
 * the refund action's id at the check-in screen. What cannot be forged is which
 * screens import the action, and the rule is that one of them has to be a
 * screen these roles can open — the same set of buttons they could have
 * pressed honestly. No known screens means no.
 */
export function canRunAction(roles: readonly TeamRole[], bundles: readonly string[]): boolean {
  if (roles.includes('owner')) return true;
  return bundles.some((b) => canOpen(roles, screenOfBundle(b)));
}

/** The screen to land on after sign-in, with its leading slash. */
export function homeFor(roles: readonly TeamRole[]): string {
  if (roles.includes('owner')) return `/${OWNER_HOME}`;
  const first = HOME_ORDER.find((r) => roles.includes(r));
  // No role at all opens nothing. `/login` rather than a dashboard path, so a
  // caller that redirects here cannot loop.
  return first ? `/${RULES[first].home}` : '/login';
}

/**
 * CSV downloads live at `/export/{kind}`, outside the nav tree, so they are
 * mapped onto the role that owns the screen each one is downloaded from.
 * A kind not listed here is an owner's.
 */
const EXPORT_ROLE: Record<string, Exclude<TeamRole, 'owner'>> = {
  orders: 'finance',
  speakers: 'agenda',
  sessions: 'agenda',
  sponsors: 'sponsors',
  'checked-in': 'checkin',
};

export function canExport(roles: readonly TeamRole[], kind: string): boolean {
  if (roles.includes('owner')) return true;
  const role = EXPORT_ROLE[kind];
  return Boolean(role) && roles.includes(role);
}

// ---------------------------------------------------------------------------
// A member's passphrase
// ---------------------------------------------------------------------------

/**
 * Longer than the shared one has to be, because this one guards a named
 * person's access and nobody else needs to be able to say it aloud at a desk.
 */
export const MIN_MEMBER_PASSPHRASE = 10;

/** A sentence for the form, or null when the passphrase will do. */
export function passphraseProblem(passphrase: string): string | null {
  if (passphrase.length < MIN_MEMBER_PASSPHRASE) {
    return `Use at least ${MIN_MEMBER_PASSPHRASE} characters.`;
  }
  if (passphrase.length > 200) return 'Use 200 characters or fewer.';
  if (passphrase.trim() !== passphrase) return 'Remove the space at the start or end.';
  return null;
}

const SCRYPT_N = 16384;
const SCRYPT_KEYLEN = 32;

/** `scrypt$N$salt$hash`, salted per member. The cost travels with the hash. */
export function hashPassphrase(passphrase: string, salt: Buffer = randomBytes(16)): string {
  const hash = scryptSync(passphrase, salt, SCRYPT_KEYLEN, { N: SCRYPT_N });
  return `scrypt$${SCRYPT_N}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

/** False for a wrong passphrase and for a stored value it cannot read. */
export function verifyPassphrase(passphrase: string, stored: string | undefined): boolean {
  if (!stored) return false;
  const [scheme, n, salt, hash] = stored.split('$');
  const cost = Number(n);
  if (scheme !== 'scrypt' || !salt || !hash || !Number.isInteger(cost) || cost < 2) return false;
  try {
    const expected = Buffer.from(hash, 'base64url');
    const actual = scryptSync(passphrase, Buffer.from(salt, 'base64url'), expected.length, { N: cost });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// The set-passphrase link
// ---------------------------------------------------------------------------

/** Three days: long enough to survive a weekend, short enough to go stale. */
export const SETUP_LINK_TTL_MS = 3 * 24 * 60 * 60 * 1000;

export interface SetupClaim {
  memberId: string;
  /** Random per link. The member document holds its hash, so a link works once. */
  nonce: string;
  expiresAt: number;
}

/**
 * Signed under its own label, so a session cookie can never verify as a setup
 * link or the reverse even though both use the dashboard's one secret.
 */
function signSetup(secret: string, body: string): string {
  return createHmac('sha256', secret).update(`team-setup.${body}`).digest('base64url');
}

export function newNonce(): string {
  return randomBytes(24).toString('base64url');
}

export function hashNonce(nonce: string): string {
  return createHash('sha256').update(nonce).digest('hex');
}

export function mintSetupToken(secret: string, claim: SetupClaim): string {
  const body = Buffer.from(
    JSON.stringify({ t: 'team-setup', mid: claim.memberId, n: claim.nonce, exp: claim.expiresAt }),
  ).toString('base64url');
  return `${body}.${signSetup(secret, body)}`;
}

/**
 * The claim inside a link, or null when it is forged, malformed or expired.
 * Whether it has been *used* is a fact about the member document, not the
 * token, and the caller checks that against `hashNonce(claim.nonce)`.
 */
export function readSetupToken(secret: string, token: string, now: number): SetupClaim | null {
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;

  const a = Buffer.from(mac);
  const b = Buffer.from(signSetup(secret, body));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString()) as {
      t?: unknown;
      mid?: unknown;
      n?: unknown;
      exp?: unknown;
    };
    if (parsed.t !== 'team-setup') return null;
    if (typeof parsed.mid !== 'string' || typeof parsed.n !== 'string') return null;
    if (typeof parsed.exp !== 'number' || parsed.exp < now) return null;
    return { memberId: parsed.mid, nonce: parsed.n, expiresAt: parsed.exp };
  } catch {
    return null;
  }
}

/** `team_` + sha256 of the address, so one person is one document. */
export function memberIdFor(email: string): string {
  return `team_${createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32)}`;
}

/** Deliberately loose. The real test of an address is whether the invitation arrives. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}
