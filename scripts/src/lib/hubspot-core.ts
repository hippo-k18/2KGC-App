/**
 * The HubSpot contact sync's decisions, with no network and no Firestore in
 * them (T333, reworked in T335), so every rule is pinned by `hubspot-core.test.ts`.
 *
 * `hubspot-client.ts` talks to HubSpot and `hubspot-sync.ts` reads our data and
 * runs the queue; both ask this file what to send.
 *
 * ── One contact is one person, not one ticket ───────────────────────────────
 *
 * HubSpot has one contact per email address, and since 2026-09-26 one address
 * can hold several tickets, each its own registration. So the sync works on
 * people: the queue is keyed by normalised email, and a contact's values are
 * built from every registration of that address at the moment it is sent
 * (`personValues`). Refunding one of four tickets therefore leaves the contact
 * Registered, and the order in which registrations are queued cannot change
 * what HubSpot ends up holding.
 *
 * ── Matching, creating, and what "fill only empty fields" means ────────────
 *
 * Before sending, the sync reads the contacts by email (primary or secondary
 * address), because two choices depend on what HubSpot holds:
 *
 * - **Not in HubSpot yet:** created only when "create contacts" is on (Whova's
 *   toggle), with Lifecycle stage "lead" when that is on.
 * - **Already in HubSpot:** updated by its HubSpot id. "Always overwrite" sends
 *   every mapped value we have; "fill only empty fields" sends only the
 *   properties that are empty in HubSpot now. The `kgc_` properties this
 *   integration created are ours and are always kept current either way, or a
 *   refund could never reach a contact whose ticket property was filled at
 *   purchase.
 * - A value we do not have is never sent, so the sync never blanks a field.
 * - Lifecycle stage is only ever set on a contact that has none, because
 *   HubSpot refuses to move a stage backwards and a sales lead marked
 *   "customer" must not be dragged back to "lead" by a ticket purchase.
 *
 * Marketing contact status cannot be set through HubSpot's API
 * (`hs_marketable_status` is read-only), so contacts arrive as non-marketing,
 * which is what the owner asked for by default. The screen says how to change
 * that inside HubSpot.
 */

import {
  EVENT,
  HUBSPOT_MAX_ATTEMPTS,
  HUBSPOT_SOURCE_FIELDS,
  TIME_ZONE,
  type HubspotConfig,
  type HubspotPropertyOption,
  type HubspotSourceKey,
  type HubspotValueKind,
} from '@kgc/shared';

/** A HubSpot contact property as `GET /crm/v3/properties/contacts` returns it. */
export interface HubspotRawProperty {
  name: string;
  label?: string;
  type?: string;
  fieldType?: string;
  groupName?: string;
  hidden?: boolean;
  calculated?: boolean;
  hubspotDefined?: boolean;
  modificationMetadata?: { readOnlyValue?: boolean };
}

/** What we know about one registration, gathered by `hubspot-sync.ts`. A person may have several. */
export interface RegistrantFacts {
  registrationId: string;
  email: string;
  name?: string;
  company?: string;
  title?: string;
  ticketType?: string;
  status?: 'active' | 'cancelled' | 'transferred';
  orderStatus?: string;
  purchasedAt?: number;
  /** What was paid for this seat: its share of the order total, after discounts, before refunds. */
  amountCents?: number;
  promoCode?: string;
  inPerson?: boolean;
  checkedIn: boolean;
}

/** Properties the sync manages itself and never offers on the mapping screen. */
const RESERVED = new Set(['email', 'lifecyclestage', 'hs_marketable_status', 'hs_object_id']);

/** Contacts per HubSpot batch call, HubSpot's own cap. */
export const HUBSPOT_BATCH = 100;

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/** "Ada Lovelace King" to Ada / Lovelace King. One word is a first name only. */
export function splitName(name: string | undefined): { first?: string; last?: string } {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return {};
  if (words.length === 1) return { first: words[0] };
  return { first: words[0], last: words.slice(1).join(' ') };
}

export function registrationStatusLabel(f: RegistrantFacts): string {
  if (f.status === 'transferred') return 'Transferred';
  if (f.orderStatus === 'refunded') return 'Refunded';
  if (f.status === 'cancelled') return 'Cancelled';
  return 'Registered';
}

type SourceValue = string | number | boolean | null;

/** A ticket that still admits its holder: not cancelled, transferred or refunded. */
export function isLive(f: RegistrantFacts): boolean {
  return registrationStatusLabel(f) === 'Registered';
}

const byNewest = (a: RegistrantFacts, b: RegistrantFacts) =>
  (b.purchasedAt ?? 0) - (a.purchasedAt ?? 0) || a.registrationId.localeCompare(b.registrationId);

const uniqueSorted = (xs: (string | undefined)[]) =>
  [...new Set(xs.map((x) => x?.trim()).filter((x): x is string => Boolean(x)))].sort((a, b) => a.localeCompare(b));

/**
 * Every source field's value for one person, from all of their registrations;
 * null when we do not have it. Deterministic: the same registrations give the
 * same values whatever order they come in.
 *
 * - Status: Registered if any ticket is live; otherwise Refunded, Cancelled,
 *   Transferred, in that order.
 * - Ticket type, attendance and promo code: from the live tickets (or all of
 *   them when none is live), each value once, alphabetical. Attendance is
 *   "In person and virtual" for a mix.
 * - Amount: the sum paid across all their tickets, before refunds.
 * - Order date: the first purchase. Checked in: any ticket.
 * - Name, company, job title: from the newest live ticket, falling back to the
 *   newest ticket that has the value.
 */
export function personValues(regs: readonly RegistrantFacts[]): Record<HubspotSourceKey, SourceValue> {
  const all = [...regs].sort(byNewest);
  const live = all.filter(isLive);
  const pool = live.length ? live : all;
  const pick = (get: (r: RegistrantFacts) => string | undefined): string | null => {
    for (const r of [...live, ...all]) {
      const v = get(r)?.trim();
      if (v) return v;
    }
    return null;
  };
  const { first, last } = splitName(pick((r) => r.name) ?? undefined);
  const labels = new Set(all.map(registrationStatusLabel));
  const status = live.length
    ? 'Registered'
    : labels.has('Refunded')
      ? 'Refunded'
      : labels.has('Cancelled')
        ? 'Cancelled'
        : all.length
          ? 'Transferred'
          : null;
  const types = uniqueSorted(pool.map((r) => r.ticketType));
  const modes = new Set(pool.map((r) => r.inPerson).filter((x): x is boolean => typeof x === 'boolean'));
  const amounts = all.map((r) => r.amountCents).filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  const dates = all.map((r) => r.purchasedAt).filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  const promos = uniqueSorted(pool.map((r) => r.promoCode));
  return {
    firstName: first ?? null,
    lastName: last ?? null,
    company: pick((r) => r.company),
    jobTitle: pick((r) => r.title),
    ticketType: types.length ? types.join(', ') : null,
    orderDate: dates.length ? Math.min(...dates) : null,
    amount: amounts.length ? amounts.reduce((a, b) => a + b, 0) / 100 : null,
    attendance: modes.size === 0 ? null : modes.size === 2 ? 'In person and virtual' : modes.has(true) ? 'In person' : 'Virtual',
    promoCode: promos.length ? promos.join(', ') : null,
    checkedIn: all.length ? all.some((r) => r.checkedIn) : null,
    registrationStatus: status,
  };
}

/** One registration's values, the same as a person with one ticket. */
export function sourceValues(f: RegistrantFacts): Record<HubspotSourceKey, SourceValue> {
  return personValues([f]);
}

/**
 * The paid price of one seat in an order: the order total shared across its
 * lines in proportion to list price, so a 50% promo on a two-seat order sends
 * half the list price per seat, not the list price.
 */
export function seatPaidCents(
  order: { totalCents?: number; items?: { unitPriceCents?: number; quantity?: number }[] } | undefined,
  line: { unitPriceCents?: number } | undefined,
): number | undefined {
  if (!order || typeof order.totalCents !== 'number') return undefined;
  const items = Array.isArray(order.items) ? order.items : [];
  const list = items.reduce((n, l) => n + (Number(l.unitPriceCents) || 0) * Math.max(1, Number(l.quantity) || 1), 0);
  const seats = items.reduce((n, l) => n + Math.max(1, Number(l.quantity) || 1), 0);
  if (!line || typeof line.unitPriceCents !== 'number') return seats <= 1 ? order.totalCents : undefined;
  if (list <= 0) return seats <= 1 ? order.totalCents : 0;
  return Math.round((order.totalCents * line.unitPriceCents) / list);
}

/**
 * The day in the event's time zone, as YYYY-MM-DD. Not the UTC day: a ticket
 * bought at 9pm in New York was bought that day, not the next.
 */
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const isoDay = (ms: number) => dayFormat.format(new Date(ms));

/**
 * A value as HubSpot wants it for a property of `type`. HubSpot takes every
 * property value as a string: a date as `YYYY-MM-DD`, a number as digits, a
 * checkbox as `true` / `false`. Text properties get the readable form.
 */
export function formatValue(kind: HubspotValueKind, value: SourceValue, propType: string): string | null {
  if (value === null || value === undefined) return null;
  switch (propType) {
    case 'date':
      return kind === 'date' && typeof value === 'number' ? isoDay(value) : null;
    case 'datetime':
      return kind === 'date' && typeof value === 'number' ? new Date(value).toISOString() : null;
    case 'number':
      return kind === 'number' && typeof value === 'number' ? String(Math.round(value * 100) / 100) : null;
    case 'bool':
    case 'enumeration':
      return kind === 'bool' && typeof value === 'boolean' ? String(value) : null;
    default:
      if (kind === 'date' && typeof value === 'number') return isoDay(value);
      if (kind === 'bool') return value ? 'Yes' : 'No';
      if (kind === 'number' && typeof value === 'number') return (Math.round(value * 100) / 100).toFixed(2);
      return String(value);
  }
}

// ---------------------------------------------------------------------------
// Properties and mapping
// ---------------------------------------------------------------------------

/** May a field of `kind` go into this property? Text takes anything; the others need their own type. */
export function compatible(kind: HubspotValueKind, prop: { type: string; fieldType: string }): boolean {
  if (prop.type === 'string') return prop.fieldType !== 'file' && prop.fieldType !== 'html';
  if (kind === 'date') return prop.type === 'date' || prop.type === 'datetime';
  if (kind === 'number') return prop.type === 'number';
  if (kind === 'bool') return prop.type === 'bool' || (prop.type === 'enumeration' && prop.fieldType === 'booleancheckbox');
  return false;
}

/** The properties an organizer may map to: writable, visible, not computed, not reserved. Sorted by label. */
export function mappableProperties(raw: readonly HubspotRawProperty[]): HubspotPropertyOption[] {
  return raw
    .filter(
      (p) =>
        typeof p.name === 'string' &&
        !RESERVED.has(p.name) &&
        !p.hidden &&
        !p.calculated &&
        !p.modificationMetadata?.readOnlyValue &&
        (p.type === 'string' || p.type === 'number' || p.type === 'date' || p.type === 'datetime' || p.type === 'bool' ||
          (p.type === 'enumeration' && p.fieldType === 'booleancheckbox')),
    )
    .map((p) => ({ name: p.name, label: p.label || p.name, type: p.type!, fieldType: p.fieldType ?? '', groupName: p.groupName ?? '', hubspotDefined: p.hubspotDefined === true }))
    .sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }) || a.name.localeCompare(b.name));
}

/** HubSpot's own properties each of our fields may fill. Every other HubSpot-defined property is off limits. */
const STANDARD_TARGETS: Partial<Record<HubspotSourceKey, readonly string[]>> = {
  firstName: ['firstname'],
  lastName: ['lastname'],
  company: ['company'],
  jobTitle: ['jobtitle'],
};

/** Consent, subscription and similar properties are never offered, even custom ones: ticket data is not consent. */
const CONSENT_LIKE = /consent|subscri|opt[\s_-]?(in|out)|unsubscri|marketing|gdpr|legal[\s_-]?basis|newsletter|do[\s_-]?not/i;

/**
 * The properties one of our fields may go into: HubSpot's matching standard
 * property for the name, company and job title fields, and otherwise only
 * custom properties of a compatible type that are not about consent. So
 * Checked in can never land in "Newsletter opt in", nor Amount paid in
 * "Annual Revenue".
 */
export function fieldOptions(field: { key: HubspotSourceKey; kind: HubspotValueKind }, props: readonly HubspotPropertyOption[]): HubspotPropertyOption[] {
  const standard = STANDARD_TARGETS[field.key] ?? [];
  return props.filter((p) => {
    if (!compatible(field.kind, p)) return false;
    if (CONSENT_LIKE.test(p.name) || CONSENT_LIKE.test(p.label)) return false;
    if (p.hubspotDefined) return standard.includes(p.name);
    return true;
  });
}

export type MappingCheck =
  | { ok: true; mapping: Partial<Record<HubspotSourceKey, string>> }
  | { ok: false; problems: string[] };

/**
 * Check a mapping against HubSpot's real property list: every target exists,
 * can hold the value, and is used once. A blank entry means "do not send".
 */
export function checkMapping(input: unknown, props: readonly HubspotPropertyOption[]): MappingCheck {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, problems: ['The field mapping is missing.'] };
  const byName = new Map(props.map((p) => [p.name, p]));
  const out: Partial<Record<HubspotSourceKey, string>> = {};
  const problems: string[] = [];
  const used = new Map<string, string>();
  for (const field of HUBSPOT_SOURCE_FIELDS) {
    const v = (input as Record<string, unknown>)[field.key];
    if (v === undefined || v === null || v === '') continue;
    if (typeof v !== 'string') {
      problems.push(`${field.label}: choose a HubSpot property or Do not send.`);
      continue;
    }
    const prop = byName.get(v);
    if (!prop) {
      problems.push(`${field.label}: HubSpot has no writable contact property "${v.slice(0, 80)}".`);
      continue;
    }
    if (!compatible(field.kind, prop)) {
      problems.push(`${field.label}: "${prop.label}" is a ${prop.type} property and cannot hold this value.`);
      continue;
    }
    if (!fieldOptions(field, [prop]).length) {
      problems.push(`${field.label}: "${prop.label}" is not a suitable place for this value. Choose one of the listed properties.`);
      continue;
    }
    const other = used.get(v);
    if (other) {
      problems.push(`${field.label}: "${prop.label}" is already used for ${other}.`);
      continue;
    }
    used.set(v, field.label);
    out[field.key] = v;
  }
  return problems.length ? { ok: false, problems } : { ok: true, mapping: out };
}

/** The `kgc_` properties the screen offers to create, named for this year's event. */
export function kgcPropertyDefs(year = EVENT_YEAR): {
  key: HubspotSourceKey;
  name: string;
  label: string;
  type: string;
  fieldType: string;
  options?: { label: string; value: string; displayOrder: number; hidden: boolean }[];
}[] {
  const p = `kgc_${year}_`;
  const bool = [
    // `hidden` is required on every option by HubSpot's property spec (OptionInput: hidden, label, value).
    { label: 'Yes', value: 'true', displayOrder: 0, hidden: false },
    { label: 'No', value: 'false', displayOrder: 1, hidden: false },
  ];
  return [
    { key: 'ticketType', name: `${p}ticket`, label: `KGC ${year} ticket`, type: 'string', fieldType: 'text' },
    { key: 'orderDate', name: `${p}order_date`, label: `KGC ${year} order date`, type: 'date', fieldType: 'date' },
    { key: 'amount', name: `${p}amount`, label: `KGC ${year} amount paid`, type: 'number', fieldType: 'number' },
    { key: 'attendance', name: `${p}attendance`, label: `KGC ${year} attendance`, type: 'string', fieldType: 'text' },
    { key: 'promoCode', name: `${p}promo_code`, label: `KGC ${year} promo code`, type: 'string', fieldType: 'text' },
    { key: 'checkedIn', name: `${p}checked_in`, label: `KGC ${year} checked in`, type: 'enumeration', fieldType: 'booleancheckbox', options: bool },
    { key: 'registrationStatus', name: `${p}status`, label: `KGC ${year} registration status`, type: 'string', fieldType: 'text' },
  ];
}

/** The event year, from the event id (`kgc-2027`). */
export const EVENT_YEAR = /(\d{4})/.exec(EVENT.id)?.[1] ?? String(new Date().getUTCFullYear());

/** Ours, so always kept current even in "fill only empty fields" mode. */
export function isKgcProperty(name: string): boolean {
  return /^kgc_\d{4}_/.test(name);
}

// ---------------------------------------------------------------------------
// Planning what to send
// ---------------------------------------------------------------------------

/** A contact as `batch/read` found it: its HubSpot id and current values. */
export interface CurrentContact {
  id: string;
  properties: Record<string, string | null>;
}

export interface PlannedUpdate {
  email: string;
  id: string;
  properties: Record<string, string>;
}

export interface PlannedCreate {
  email: string;
  properties: Record<string, string>;
}

export interface PlanResult {
  updates: PlannedUpdate[];
  creates: PlannedCreate[];
  /** Not sent on purpose; `logged` is false for "already up to date", which is not worth a log line. */
  skipped: { email: string; message: string; logged: boolean }[];
}

const empty = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/**
 * What to send for each person, given what HubSpot holds now (`current`, by
 * the email we asked with; absent means not in HubSpot).
 */
export function planContacts(
  people: readonly { email: string; registrations: readonly RegistrantFacts[] }[],
  current: ReadonlyMap<string, CurrentContact>,
  config: Pick<HubspotConfig, 'mapping' | 'mode' | 'createContacts' | 'setLeadStage'>,
  propTypes: ReadonlyMap<string, string>,
): PlanResult {
  const out: PlanResult = { updates: [], creates: [], skipped: [] };
  const seen = new Set<string>();
  for (const person of people) {
    const email = person.email.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    if (person.registrations.length === 0) {
      out.skipped.push({ email, message: 'No registration uses this address any more, so nothing was sent.', logged: true });
      continue;
    }
    const values = personValues(person.registrations);
    const now = current.get(email);
    if (!now && !config.createContacts) {
      out.skipped.push({ email, message: 'Not in HubSpot, and creating new contacts is off.', logged: true });
      continue;
    }
    const properties: Record<string, string> = {};
    for (const field of HUBSPOT_SOURCE_FIELDS) {
      const target = config.mapping[field.key];
      if (!target) continue;
      const v = formatValue(field.kind, values[field.key], propTypes.get(target) ?? 'string');
      if (v === null) continue;
      if (now && config.mode === 'fill-empty' && !isKgcProperty(target) && !empty(now.properties[target])) continue;
      if (now && now.properties[target] === v) continue;
      properties[target] = v;
    }
    if (config.setLeadStage && (!now || empty(now.properties.lifecyclestage))) properties.lifecyclestage = 'lead';
    if (!now) {
      out.creates.push({ email, properties: { email, ...properties } });
    } else if (Object.keys(properties).length === 0) {
      out.skipped.push({ email, message: 'Already up to date.', logged: false });
    } else {
      out.updates.push({ email, id: now.id, properties });
    }
  }
  return out;
}

/** The properties to read before planning: everything mapped, plus lifecycle stage. */
export function propertiesToRead(mapping: HubspotConfig['mapping']): string[] {
  return [...new Set(['email', 'hs_additional_emails', 'lifecyclestage', ...Object.values(mapping).filter((v): v is string => Boolean(v))])];
}

export function chunk<T>(items: readonly T[], size = HUBSPOT_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// Errors and retries
// ---------------------------------------------------------------------------

/** What went wrong with a call, for choosing what to do next and what to say. */
export type HubspotErrorKind = 'auth' | 'scope' | 'rate' | 'daily' | 'server' | 'network' | 'timeout' | 'conflict' | 'bad-request';

export function errorKind(status: number, body: unknown): HubspotErrorKind {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const category = typeof b.category === 'string' ? b.category : '';
  if (status === 401 || category === 'INVALID_AUTHENTICATION') return 'auth';
  if (status === 403 || category === 'MISSING_SCOPES') return 'scope';
  if (status === 429) return /DAILY/i.test(String(b.policyName ?? '')) ? 'daily' : 'rate';
  if (status >= 500) return 'server';
  if (status === 409) return 'conflict';
  return 'bad-request';
}

/**
 * One readable line for a refused call, never echoing a token. Plain facts,
 * with no promise of a retry: the sync log adds that where the queue really
 * does retry, and a button press on the screen does not.
 */
export function hubspotErrorMessage(status: number, body: unknown): string {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  switch (errorKind(status, body)) {
    case 'auth':
      return 'HubSpot refused the access token. It may have been rotated or deleted. Paste a new one.';
    case 'scope':
      return 'The HubSpot app is missing a permission. It needs crm.objects.contacts.read, crm.objects.contacts.write, crm.schemas.contacts.read and crm.schemas.contacts.write.';
    case 'daily':
      return "This HubSpot account has used up its daily API allowance. Sending resumes after midnight in the account's time zone.";
    case 'rate':
      return 'HubSpot is limiting how fast this app can send. Wait a minute and try again.';
    case 'server':
      return `HubSpot had a problem on its side (HTTP ${status}). Try again in a few minutes.`;
    default: {
      const message = typeof b.message === 'string' ? readableValidation(b.message) : `HubSpot refused the request (HTTP ${status}).`;
      return redact(message).slice(0, 300);
    }
  }
}

/**
 * HubSpot's validation message in words. It often embeds a JSON list
 * ("Property values were not valid: [{"message":"Email address x is invalid",...}]");
 * the inner messages are what an organizer needs, not the JSON.
 */
export function readableValidation(message: string): string {
  const m = /^(.*?)\s*(\[\s*\{[\s\S]*\])\s*$/.exec(message);
  if (!m) return message;
  try {
    const list = JSON.parse(m[2]) as { message?: unknown }[];
    const inner = list.map((x) => (typeof x?.message === 'string' ? x.message.trim() : '')).filter(Boolean);
    if (inner.length === 0) return message;
    return `${m[1].replace(/:\s*$/, '').trim() || 'HubSpot refused it'}: ${inner.join('; ')}`;
  } catch {
    return message;
  }
}

/** For a failure to reach HubSpot at all, instead of "fetch failed". */
export function networkErrorMessage(timedOut: boolean): string {
  return timedOut
    ? 'HubSpot did not answer in time. Try again in a few minutes.'
    : "Could not reach HubSpot. Check this server's internet connection, or try again in a few minutes.";
}

/** Strip anything shaped like a token from text that may be shown or stored; `exact` also removes that token however it is shaped. */
export function redact(text: string, exact?: string): string {
  let out = text;
  if (exact && exact.length >= 8) out = out.split(exact).join('[token]');
  return out.replace(/pat-[a-z0-9]{2,4}-[0-9a-f-]{20,}/gi, '[token]').replace(/Bearer\s+\S+/gi, 'Bearer [token]');
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * How long to wait before retrying a call that HubSpot answered 429 or 5xx.
 * HubSpot documents no Retry-After for its API; its rate-limit window is 10
 * seconds, so the wait starts there for a 429 and doubles.
 */
export function retryDelayMs(attempt: number, status: number, rand = Math.random): number {
  const base = status === 429 ? 10_000 : 1_000;
  const ms = Math.min(base * 2 ** attempt, 60_000);
  return Math.round(ms * (0.8 + 0.4 * rand()));
}

/**
 * When a contact whose own record failed is tried again: 5 minutes, doubling,
 * capped at 6 hours. After `HUBSPOT_MAX_ATTEMPTS` it is parked (shown in the
 * log, retried only when something queues it again).
 */
export function nextAttemptAt(attempts: number, now: number): { at: number; failed: boolean } {
  if (attempts >= HUBSPOT_MAX_ATTEMPTS) return { at: PARKED_AT, failed: true };
  return { at: now + Math.min(5 * 60_000 * 2 ** Math.max(0, attempts - 1), 6 * 3_600_000), failed: false };
}

/** Far enough ahead that a parked item never comes due, small enough to store as a number. */
export const PARKED_AT = 8_640_000_000_000_000;

/** The token as the screen shows it. */
export function maskToken(last4: string | undefined): string {
  return last4 ? `pat-****-****${last4}` : '';
}

/**
 * Could this be a HubSpot access token? Checked before it is tested, so a
 * pasted sentence or a URL is refused with a clear message. Private app tokens
 * look like `pat-na1-<uuid>`, and HubSpot's newer service keys may not carry
 * the `pat-` prefix, so the check is loose: one word of 20 to 500 token
 * characters. HubSpot itself is the real test. A URL (the private app's page
 * is the likeliest wrong paste) and other services' secret keys are refused
 * here, so a Stripe key pasted into the wrong box is never sent to HubSpot.
 */
export function looksLikeHubspotToken(token: unknown): token is string {
  if (typeof token !== 'string') return false;
  const t = token.trim();
  if (!/^[A-Za-z0-9._:~+/=-]{20,500}$/.test(t)) return false;
  if (/:\/\/|^(https?:|www\.)|\.(com|net|org|io)(\/|$)/i.test(t)) return false;
  if (/^(sk|rk|pk)_(live|test)_|^whsec_|^re_[A-Za-z0-9]{8,}_/.test(t)) return false;
  return true;
}

/** The four scopes the sync needs, and which of them a token lacks. */
export const HUBSPOT_SCOPES = [
  'crm.objects.contacts.read',
  'crm.objects.contacts.write',
  'crm.schemas.contacts.read',
  'crm.schemas.contacts.write',
] as const;

export function missingScopes(granted: readonly string[]): string[] {
  return HUBSPOT_SCOPES.filter((s) => !granted.includes(s));
}
