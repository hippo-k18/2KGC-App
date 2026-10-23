/**
 * The HubSpot contact sync's Firestore half (T333, reworked in T335): settings, the encrypted
 * token, the queue and the run that drains it. Shared by the website (a paid
 * order, a refund) and the dashboard (settings, Sync all now, a ticket change,
 * a check-in), which is why it lives here and takes the caller's `store`.
 *
 * ── Never in the way of a sale ──────────────────────────────────────────────
 *
 * A trigger only writes one `hubspotQueue/{personKey}` document per person
 * (keyed by email: a contact is a person, who may hold several tickets), and
 * only when the sync is switched on with a token saved; otherwise it reads one
 * settings document and returns. While HubSpot refuses the token, changes keep
 * queueing and go out once a good token is back. The caller then starts a drain without
 * awaiting it. Every trigger is wrapped by its caller in try/catch, so a
 * HubSpot outage or a bad token can never fail a checkout, a refund or a scan.
 * Items that HubSpot rejects stay queued with backoff, and the dashboard's
 * retry timer (`/api/cron/hubspot`) picks them up.
 *
 * Only one drain runs at a time: a lease in `integrations/hubspotLock` is taken
 * in a transaction, so the website and the dashboard never send the same
 * contact twice at once.
 *
 * No Firestore sentinels in this file (AGENTS.md gotcha 8): times are numbers.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { DocumentReference, Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  EVENT_ID,
  HUBSPOT_CONFIG_DEFAULT,
  HUBSPOT_RUNS_KEPT,
  type HubspotConfig,
  type HubspotQueueItem,
  type HubspotRun,
  type HubspotTrigger,
} from '@kgc/shared';
import {
  HubspotError,
  createContacts,
  readContactsIsolating,
  sendIsolating,
  updateContacts,
  type ClientOptions,
  type SendOutcome,
} from './hubspot-client.js';
import {
  HUBSPOT_BATCH,
  isKgcProperty,
  nextAttemptAt,
  planContacts,
  propertiesToRead,
  seatPaidCents,
  type RegistrantFacts,
} from './hubspot-core.js';
import { openToken, sealToken, tokenState } from './hubspot-secret.js';

const configRef = (s: Firestore) => s.collection(COLLECTIONS.integrations).doc('hubspot');
const secretRef = (s: Firestore) => s.collection(COLLECTIONS.integrations).doc('hubspotSecret');
const lockRef = (s: Firestore) => s.collection(COLLECTIONS.integrations).doc('hubspotLock');
const runsCol = (s: Firestore) => configRef(s).collection('runs');
const queueCol = (s: Firestore) => s.collection(COLLECTIONS.hubspotQueue);

/** The saved settings with defaults filled in, and whether a token is stored. */
export async function readHubspotConfig(store: Firestore): Promise<HubspotConfig & { hasToken: boolean }> {
  const [c, t] = await Promise.all([configRef(store).get(), secretRef(store).get()]);
  const saved = (c.exists ? c.data() : {}) as Partial<HubspotConfig>;
  return { ...HUBSPOT_CONFIG_DEFAULT, ...saved, mapping: saved.mapping ?? HUBSPOT_CONFIG_DEFAULT.mapping, hasToken: t.exists };
}

/** The token, or null when none is saved or it cannot be decrypted. Server only; never send it to a browser. */
export async function loadHubspotToken(store: Firestore): Promise<string | null> {
  const snap = await secretRef(store).get();
  return snap.exists ? openToken(snap.get('sealed')) : null;
}

/** Is a token saved, and can this server read it? For the screen, which must not call an unreadable token "refused". */
export async function readHubspotTokenState(store: Firestore): Promise<'none' | 'ok' | 'unreadable'> {
  const snap = await secretRef(store).get();
  return snap.exists ? tokenState(snap.get('sealed')) : 'none';
}

/** Should a drain send now? Switched on, with a token HubSpot has not refused and this server can read. */
export function isHubspotActive(c: HubspotConfig & { hasToken: boolean }): boolean {
  return c.enabled && c.hasToken && !c.tokenRejectedAt && !c.tokenUnreadableAt;
}

/** Whole-document write of the settings, so a cleared field is really cleared (gotcha 9). */
async function writeConfig(store: Firestore, next: HubspotConfig): Promise<void> {
  const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined));
  delete (clean as Record<string, unknown>).hasToken;
  await configRef(store).set(clean);
}

export async function saveHubspotToken(store: Firestore, token: string, actor: string, portalId?: number): Promise<HubspotConfig> {
  const cur = await readHubspotConfig(store);
  await secretRef(store).set({ sealed: sealToken(token.trim()), savedAt: Date.now(), savedBy: actor });
  const next: HubspotConfig = {
    ...cur,
    tokenLast4: token.trim().slice(-4),
    portalId,
    connectedAt: Date.now(),
    connectedBy: actor,
    tokenRejectedAt: undefined,
    tokenUnreadableAt: undefined,
    updatedAt: Date.now(),
    updatedBy: actor,
  };
  await writeConfig(store, next);
  return next;
}

/** Forget the token and switch the sync off. Queued contacts stay queued for a reconnect. */
export async function disconnectHubspot(store: Firestore, actor: string): Promise<void> {
  const cur = await readHubspotConfig(store);
  await secretRef(store).delete();
  await writeConfig(store, {
    ...cur,
    enabled: false,
    tokenLast4: undefined,
    portalId: undefined,
    connectedAt: undefined,
    connectedBy: undefined,
    tokenRejectedAt: undefined,
    tokenUnreadableAt: undefined,
    updatedAt: Date.now(),
    updatedBy: actor,
  });
}

export async function saveHubspotSettings(
  store: Firestore,
  patch: Partial<Pick<HubspotConfig, 'enabled' | 'mapping' | 'mode' | 'createContacts' | 'setLeadStage'>>,
  actor: string,
): Promise<HubspotConfig> {
  const cur = await readHubspotConfig(store);
  const next: HubspotConfig = { ...cur, ...patch, updatedAt: Date.now(), updatedBy: actor };
  await writeConfig(store, next);
  return next;
}

/** HubSpot refused the token (a 401 on Test connection or during a sync): the sync pauses until a new token or a good test. */
export async function markTokenRejected(store: Firestore): Promise<void> {
  const cur = await readHubspotConfig(store);
  await writeConfig(store, { ...cur, tokenRejectedAt: Date.now() });
}

export async function markTokenAccepted(store: Firestore, portalId?: number): Promise<void> {
  const cur = await readHubspotConfig(store);
  await writeConfig(store, { ...cur, tokenRejectedAt: undefined, tokenUnreadableAt: undefined, portalId: portalId ?? cur.portalId });
}

// ---------------------------------------------------------------------------
// The queue: one document per person
// ---------------------------------------------------------------------------

/** The queue document id for a person: a hash of the normalised email, which may hold characters a document id cannot. */
export function hubspotPersonKey(email: string): string {
  return `p_${createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 40)}`;
}

/**
 * Should a trigger queue a change? Yes whenever the sync is switched on with a
 * token saved, even while HubSpot is refusing that token: the changes wait and
 * go out once the token is fixed, instead of being lost.
 */
export function isHubspotQueueing(c: HubspotConfig & { hasToken: boolean }): boolean {
  return c.enabled && c.hasToken;
}

/**
 * Queue people for the next drain, by email. Returns how many were queued (0
 * when the sync is off). A person already queued is reset to "due now" with a
 * fresh write, which is also what tells a drain in flight that their data
 * changed after it read them (see `settle`).
 */
export async function enqueueHubspotEmails(store: Firestore, emails: readonly string[], trigger: HubspotTrigger): Promise<number> {
  const unique = [...new Set(emails.map((e) => (typeof e === 'string' ? e.trim().toLowerCase() : '')).filter((e) => e.includes('@')))];
  if (unique.length === 0) return 0;
  if (!isHubspotQueueing(await readHubspotConfig(store))) return 0;
  const now = Date.now();
  for (let i = 0; i < unique.length; i += 400) {
    const batch = store.batch();
    for (const email of unique.slice(i, i + 400)) {
      const doc: HubspotQueueItem = { email, triggers: [trigger], enqueuedAt: now, attempts: 0, nextAttemptAt: now };
      batch.set(queueCol(store).doc(hubspotPersonKey(email)), doc);
    }
    await batch.commit();
  }
  return unique.length;
}

/** Queue the people behind some registrations. Ids that do not exist are ignored. */
export async function enqueueHubspotRegistrations(store: Firestore, registrationIds: readonly string[], trigger: HubspotTrigger): Promise<number> {
  const ids = [...new Set(registrationIds.filter((x) => typeof x === 'string' && x !== ''))];
  if (ids.length === 0) return 0;
  if (!isHubspotQueueing(await readHubspotConfig(store))) return 0;
  const snaps = await store.getAll(...ids.map((id) => store.collection(COLLECTIONS.registrations).doc(id)));
  return enqueueHubspotEmails(store, snaps.filter((s) => s.exists).map((s) => String(s.get('email') ?? '')), trigger);
}

/** Sync all now: every person holding a registration for this event, once each. */
export async function enqueueAllRegistrations(store: Firestore): Promise<number> {
  const snap = await store.collection(COLLECTIONS.registrations).where('eventId', '==', EVENT_ID).select('email').get();
  return enqueueHubspotEmails(store, snap.docs.map((d) => String(d.get('email') ?? '')), 'backfill');
}

export async function queueCounts(store: Firestore): Promise<{ waiting: number; parked: number }> {
  const [all, parked] = await Promise.all([
    queueCol(store).count().get(),
    queueCol(store).where('failed', '==', true).count().get(),
  ]);
  return { waiting: all.data().count - parked.data().count, parked: parked.data().count };
}

// ---------------------------------------------------------------------------
// Facts about a person
// ---------------------------------------------------------------------------

function toMs(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  if (v && typeof (v as { toMillis?: unknown }).toMillis === 'function') return (v as { toMillis(): number }).toMillis();
  return undefined;
}

type Doc = Record<string, unknown>;

/** What one registration contributes: its seat's share of the order, and the ticket it holds now. */
export function registrationFacts(
  id: string,
  d: Doc,
  order: Doc | undefined,
  tierById: ReadonlyMap<string, Doc>,
  tierByName: ReadonlyMap<string, Doc>,
  checkedIn: boolean,
): RegistrantFacts {
  const email = String(d.email ?? '').trim().toLowerCase();
  const lines = Array.isArray(order?.items) ? (order!.items as Doc[]) : [];
  const line =
    lines.find((l) => String(l.attendeeEmail ?? '').trim().toLowerCase() === email) ??
    lines.find((l) => l.ticketTypeName === d.ticketType) ??
    (lines.length === 1 ? lines[0] : undefined);
  // The ticket held now wins over the one bought: an organizer may have changed it since.
  const tier =
    (typeof d.ticketType === 'string' ? tierByName.get(d.ticketType) : undefined) ??
    (typeof line?.ticketTypeId === 'string' ? tierById.get(line.ticketTypeId) : undefined);
  return {
    registrationId: id,
    email,
    name: typeof d.name === 'string' ? d.name : undefined,
    company: typeof d.company === 'string' ? d.company : undefined,
    title: typeof d.title === 'string' ? d.title : undefined,
    ticketType: typeof d.ticketType === 'string' ? d.ticketType : undefined,
    status: d.status === 'cancelled' || d.status === 'transferred' ? d.status : 'active',
    orderStatus: typeof order?.status === 'string' ? order.status : undefined,
    purchasedAt: toMs(order?.purchasedAt),
    amountCents: seatPaidCents(order as never, line as never),
    promoCode: typeof order?.promotionCode === 'string' ? order.promotionCode : undefined,
    inPerson: typeof tier?.inPerson === 'boolean' ? tier.inPerson : undefined,
    checkedIn,
  };
}

/**
 * A later order on an existing registration (an extra such as Workshops added
 * to a badge another order issued), as one more ticket: its own line, price,
 * date, promo and tier, under the registration's status and check-in.
 */
export function extraOrderFacts(
  registrationId: string,
  d: Doc,
  orderId: string,
  order: Doc,
  tierById: ReadonlyMap<string, Doc>,
  tierByName: ReadonlyMap<string, Doc>,
  checkedIn: boolean,
): RegistrantFacts {
  const email = String(d.email ?? '').trim().toLowerCase();
  const lines = Array.isArray(order.items) ? (order.items as Doc[]) : [];
  const line = lines.find((l) => String(l.attendeeEmail ?? '').trim().toLowerCase() === email) ?? lines[0];
  const tier =
    (typeof line?.ticketTypeId === 'string' ? tierById.get(line.ticketTypeId) : undefined) ??
    (typeof line?.ticketTypeName === 'string' ? tierByName.get(line.ticketTypeName) : undefined);
  return {
    registrationId: `${registrationId}#${orderId}`,
    email,
    name: typeof d.name === 'string' ? d.name : undefined,
    company: typeof d.company === 'string' ? d.company : undefined,
    title: typeof d.title === 'string' ? d.title : undefined,
    ticketType: typeof line?.ticketTypeName === 'string' ? line.ticketTypeName : typeof tier?.name === 'string' ? tier.name : undefined,
    status: d.status === 'cancelled' || d.status === 'transferred' ? d.status : 'active',
    orderStatus: typeof order.status === 'string' ? order.status : undefined,
    purchasedAt: toMs(order.purchasedAt),
    amountCents: seatPaidCents(order as never, line as never),
    promoCode: typeof order.promotionCode === 'string' ? order.promotionCode : undefined,
    inPerson: typeof tier?.inPerson === 'boolean' ? tier.inPerson : undefined,
    checkedIn,
  };
}

/** Every registration of each email, as facts. An email with none maps to an empty list. */
export async function gatherPeople(store: Firestore, emails: readonly string[]): Promise<Map<string, RegistrantFacts[]>> {
  const wanted = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const out = new Map<string, RegistrantFacts[]>(wanted.map((e) => [e, []]));
  if (wanted.length === 0) return out;
  const regDocs: { id: string; data: Doc }[] = [];
  for (let i = 0; i < wanted.length; i += 30) {
    const snap = await store.collection(COLLECTIONS.registrations).where('email', 'in', wanted.slice(i, i + 30)).get();
    for (const d of snap.docs) {
      const data = d.data() as Doc;
      if (data.eventId !== undefined && data.eventId !== EVENT_ID) continue;
      regDocs.push({ id: d.id, data });
    }
  }
  const orderIds = [...new Set(regDocs.map((r) => r.data.orderId).filter((x): x is string => typeof x === 'string' && x !== ''))];
  // Every order that paid for one of these registrations, not only the one that issued it: a later
  // purchase (Workshops added to a Virtual badge) lists the registration in its `registrationIds` too.
  const regIds = regDocs.map((r) => r.id);
  const laterOrders = async () => {
    const found: QueryDocumentSnapshot[] = [];
    for (let i = 0; i < regIds.length; i += 30) {
      const snap = await store.collection(COLLECTIONS.orders).where('registrationIds', 'array-contains-any', regIds.slice(i, i + 30)).get();
      found.push(...snap.docs);
    }
    return found;
  };
  const [orders, extraOrders, tiers, lists] = await Promise.all([
    orderIds.length ? store.getAll(...orderIds.map((id) => store.collection(COLLECTIONS.orders).doc(id))) : Promise.resolve([]),
    regIds.length ? laterOrders() : Promise.resolve([] as QueryDocumentSnapshot[]),
    store.collection(COLLECTIONS.ticketTypes).get(),
    // `listDocuments`, not a query: a list whose parent document was never written still holds check-ins.
    store.collection(COLLECTIONS.checkInLists).listDocuments(),
  ]);
  const orderById = new Map(orders.filter((o) => o.exists).map((o) => [o.id, o.data() as Doc]));
  const tierById = new Map(tiers.docs.map((t) => [t.id, t.data() as Doc]));
  const tierByName = new Map(tiers.docs.map((t) => [String(t.get('name') ?? ''), t.data() as Doc]));
  const checkRefs: DocumentReference[] = [];
  for (const r of regDocs) for (const l of lists) checkRefs.push(l.collection('checkIns').doc(r.id));
  const checked = new Set<string>();
  for (let i = 0; i < checkRefs.length; i += 300) {
    for (const s of await store.getAll(...checkRefs.slice(i, i + 300))) if (s.exists) checked.add(s.id);
  }
  for (const r of regDocs) {
    const f = registrationFacts(r.id, r.data, typeof r.data.orderId === 'string' ? orderById.get(r.data.orderId) : undefined, tierById, tierByName, checked.has(r.id));
    out.get(f.email)?.push(f);
    // Each later order on this registration is one more ticket the person bought.
    const seen = new Set<string>([String(r.data.orderId ?? '')]);
    for (const o of extraOrders) {
      if (seen.has(o.id)) continue;
      const od = o.data() as Doc;
      if (!Array.isArray(od.registrationIds) || !(od.registrationIds as unknown[]).includes(r.id)) continue;
      seen.add(o.id);
      out.get(f.email)?.push(extraOrderFacts(r.id, r.data, o.id, od, tierById, tierByName, checked.has(r.id)));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The drain
// ---------------------------------------------------------------------------

const LEASE_MS = 5 * 60_000;

async function takeLease(store: Firestore, holder: string): Promise<boolean> {
  return store.runTransaction(async (tx) => {
    const snap = await tx.get(lockRef(store));
    const until = snap.exists ? Number(snap.get('until')) : 0;
    if (until > Date.now() && snap.get('holder') !== holder) return false;
    tx.set(lockRef(store), { holder, until: Date.now() + LEASE_MS });
    return true;
  });
}

async function releaseLease(store: Firestore, holder: string): Promise<void> {
  await store.runTransaction(async (tx) => {
    const snap = await tx.get(lockRef(store));
    if (snap.exists && snap.get('holder') === holder) tx.delete(lockRef(store));
  });
}

export interface DrainOptions {
  trigger: HubspotRun['trigger'];
  actor?: string;
  /** Stop after this many people in one run; the rest wait for the next. */
  maxContacts?: number;
  client?: ClientOptions;
}

type QueueSnap = QueryDocumentSnapshot;

/**
 * Finish with one queue document, but only if nobody re-queued it while this
 * batch was in flight: the write carries the document's update time as a
 * precondition, so a newer trigger's write wins and its change is sent on the
 * next pass instead of being deleted.
 */
async function settle(snap: QueueSnap, next: Partial<HubspotQueueItem> | null): Promise<void> {
  try {
    if (next === null) await snap.ref.delete({ lastUpdateTime: snap.updateTime });
    else await snap.ref.update(next as Doc, { lastUpdateTime: snap.updateTime });
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    // 9 FAILED_PRECONDITION: changed since we read it. 5 NOT_FOUND: already gone.
    if (code !== 9 && code !== 5) throw err;
  }
}

function validItem(d: Doc): HubspotQueueItem | null {
  if (typeof d.email !== 'string' || !d.email.includes('@')) return null;
  return {
    email: d.email.trim().toLowerCase(),
    triggers: Array.isArray(d.triggers) ? (d.triggers as HubspotTrigger[]) : [],
    enqueuedAt: typeof d.enqueuedAt === 'number' ? d.enqueuedAt : 0,
    attempts: typeof d.attempts === 'number' && Number.isFinite(d.attempts) ? d.attempts : 0,
    nextAttemptAt: typeof d.nextAttemptAt === 'number' ? d.nextAttemptAt : 0,
  };
}

/** What the log says after a stop, and whether the queue really will retry. */
function stopMessage(err: HubspotError): string {
  if (err.kind === 'auth' || err.kind === 'scope') return err.message;
  if (err.kind === 'daily') return `${err.message} Waiting contacts are sent then.`;
  // The screen's "Try again in a few minutes" is for a button; here the queue does the retrying.
  return `${err.message.replace(/\s*Try again in a few minutes\.?$/, '').replace(/\s*Wait a minute and try again\.?$/, '')} Waiting contacts are retried automatically.`;
}

/**
 * Send every due person. Returns the run written to the log, or null when the
 * sync is off, another drain holds the lease, or nothing was due.
 *
 * A bad record is isolated and logged on its own and the run carries on; a
 * run stops only when continuing cannot help (token refused, a scope missing,
 * HubSpot down or rate limiting after retries, the daily limit), and then
 * every person it could not send is counted as failed and stays queued.
 */
export async function drainHubspotQueue(store: Firestore, opts: DrainOptions): Promise<HubspotRun | null> {
  const config = await readHubspotConfig(store);
  if (!isHubspotActive(config)) return null;
  const token = await loadHubspotToken(store);
  if (!token) {
    // The saved token exists but this server cannot decrypt it (WEB_ORDER_SECRET differs). Not HubSpot's refusal.
    await writeConfig(store, { ...config, tokenUnreadableAt: Date.now() });
    return writeRun(store, emptyRun(opts, UNREADABLE));
  }
  const holder = randomUUID();
  if (!(await takeLease(store, holder))) return null;

  const run = emptyRun(opts);
  const max = opts.maxContacts ?? 5_000;
  try {
    const propTypes = await propertyTypes(store);
    const toRead = propertiesToRead(config.mapping);
    while (run.sent + run.skipped + run.failed < max) {
      if (!(await takeLease(store, holder))) break; // renewed only while still ours
      const now = Date.now();
      const due = await queueCol(store).where('nextAttemptAt', '<=', now).orderBy('nextAttemptAt').limit(HUBSPOT_BATCH).get();
      if (due.empty) break;

      const items = new Map<string, { snap: QueueSnap; item: HubspotQueueItem }>();
      for (const snap of due.docs) {
        const item = validItem(snap.data() as Doc);
        if (!item || items.has(item.email)) {
          await settle(snap, null);
          run.skipped++;
          if (!item) note(run, snap.id, 'A queue entry had no valid email address and was removed.');
          continue;
        }
        items.set(item.email, { snap, item });
      }
      if (items.size === 0) continue;

      // Who HubSpot has already accepted in this batch, so a later whole-batch failure does not re-send or miscount them.
      let updated: SendOutcome | undefined;
      let created: SendOutcome | undefined;
      try {
        const people = await gatherPeople(store, [...items.keys()]);
        const read = await readContactsIsolating(token, [...items.keys()], toRead, opts.client);
        const current = read.found;
        const plan = planContacts(
          [...people].filter(([email]) => !read.failed.has(email)).map(([email, registrations]) => ({ email, registrations })),
          current,
          config,
          propTypes,
        );
        updated = await sendIsolating(plan.updates, (b) => updateContacts(token, b, opts.client));
        created = await sendIsolating(plan.creates, (b) => createContacts(token, b, opts.client));
        // Created between our read and our create (or matched by a secondary address only HubSpot knows): update instead.
        const createdNow = created;
        const late = plan.creates
          .filter((c) => createdNow.exists.has(c.email))
          .map((c) => {
            const { email: _email, lifecyclestage: _stage, ...rest } = c.properties;
            const properties = config.mode === 'fill-empty' ? Object.fromEntries(Object.entries(rest).filter(([k]) => isKgcProperty(k))) : rest;
            return { email: c.email, id: createdNow.exists.get(c.email)!, properties };
          })
          .filter((u) => Object.keys(u.properties).length > 0);
        const lateOut = await sendIsolating(late, (b) => updateContacts(token, b, opts.client));
        for (const c of plan.creates) if (created.exists.has(c.email) && !late.some((u) => u.email === c.email)) lateOut.ok.add(c.email);

        for (const [email, { snap, item }] of items) {
          const skip = plan.skipped.find((x) => x.email === email);
          const failed = read.failed.get(email) ?? updated.failed.get(email) ?? created.failed.get(email) ?? lateOut.failed.get(email);
          if (skip) {
            await settle(snap, null);
            run.skipped++;
            if (skip.logged) note(run, email, skip.message);
          } else if (failed) {
            const attempts = item.attempts + 1;
            const next = nextAttemptAt(attempts, now);
            await settle(snap, { attempts, nextAttemptAt: next.at, failed: next.failed, lastError: failed });
            run.failed++;
            note(run, email, failed);
          } else if (updated.ok.has(email) || lateOut.ok.has(email)) {
            await settle(snap, null);
            run.sent++;
            run.updated++;
          } else if (created.ok.has(email)) {
            await settle(snap, null);
            run.sent++;
            run.created++;
          } else {
            // Not in any outcome: should not happen; keep it queued rather than claim it was sent.
            const attempts = item.attempts + 1;
            const next = nextAttemptAt(attempts, now);
            await settle(snap, { attempts, nextAttemptAt: next.at, failed: next.failed, lastError: 'HubSpot did not confirm this contact.' });
            run.failed++;
            note(run, email, 'HubSpot did not confirm this contact.');
          }
        }
      } catch (err) {
        if (!(err instanceof HubspotError)) throw err;
        // The rest of this batch could not be sent, for a reason that is not about one record.
        let unsent = 0;
        for (const [email, { snap, item }] of items) {
          if (updated?.ok.has(email) || created?.ok.has(email)) {
            await settle(snap, null);
            run.sent++;
            if (updated?.ok.has(email)) run.updated++;
            else run.created++;
            continue;
          }
          unsent++;
          if (err.kind === 'auth' || err.kind === 'scope') {
            await settle(snap, { lastError: err.message });
          } else if (err.kind === 'daily') {
            await settle(snap, { nextAttemptAt: now + 3_600_000, lastError: err.message });
          } else {
            const attempts = item.attempts + 1;
            const next = nextAttemptAt(attempts, now);
            await settle(snap, { attempts, nextAttemptAt: next.at, failed: next.failed, lastError: err.message });
          }
          run.failed++;
        }
        note(run, `${unsent} contact${unsent === 1 ? '' : 's'}`, `Not sent: ${err.message}`);
        run.stopped = stopMessage(err);
        if (err.tokenRejected) await markTokenRejected(store);
        break;
      }
    }
  } finally {
    await releaseLease(store, holder);
  }
  if (run.sent + run.skipped + run.failed === 0 && !run.stopped) return null;
  return writeRun(store, run);
}

const UNREADABLE = "The saved HubSpot token can't be read on this server (its encryption key differs). Paste the token again.";

function emptyRun(opts: DrainOptions, stopped?: string): HubspotRun {
  const r: HubspotRun = {
    startedAt: Date.now(),
    finishedAt: Date.now(),
    trigger: opts.trigger,
    actor: opts.actor ?? '',
    sent: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };
  if (stopped) r.stopped = stopped;
  return r;
}

function note(run: HubspotRun, email: string, message: string) {
  if (run.errors.length < 200) run.errors.push({ email, message });
}

async function writeRun(store: Firestore, run: HubspotRun): Promise<HubspotRun> {
  run.finishedAt = Date.now();
  await runsCol(store).add(run);
  try {
    const old = await runsCol(store).orderBy('startedAt', 'desc').offset(HUBSPOT_RUNS_KEPT).select().get();
    await Promise.all(old.docs.map((d) => d.ref.delete()));
  } catch {
    // An extra old log line costs nothing.
  }
  return run;
}

export async function listHubspotRuns(store: Firestore, limit = HUBSPOT_RUNS_KEPT): Promise<(HubspotRun & { id: string })[]> {
  const snap = await runsCol(store).orderBy('startedAt', 'desc').limit(limit).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as HubspotRun) }));
}

/** Types of the mapped properties, cached on the settings doc by the dashboard when it saves a mapping. */
async function propertyTypes(store: Firestore): Promise<Map<string, string>> {
  const snap = await configRef(store).get();
  const types = (snap.get('propertyTypes') ?? {}) as Record<string, string>;
  return new Map(Object.entries(types));
}

/** Remember each mapped property's HubSpot type, so the drain formats values without listing properties. */
export async function savePropertyTypes(store: Firestore, types: Record<string, string>): Promise<void> {
  const cur = (await configRef(store).get()).data() ?? {};
  await configRef(store).set({ ...cur, propertyTypes: types });
}

/**
 * Queue the people behind some registrations and start a drain without waiting for it: what every
 * trigger (a paid order, a refund, a ticket change, a check-in) calls. Never
 * throws and never blocks the caller beyond the one queue write; failures go
 * to `report` (the app's `recordError`).
 */
export async function queueAndKickHubspot(
  store: Firestore,
  registrationIds: readonly string[],
  trigger: HubspotTrigger,
  report: (what: string, err: unknown) => void,
): Promise<void> {
  try {
    const n = await enqueueHubspotRegistrations(store, registrationIds, trigger);
    if (n === 0) return;
    void drainHubspotQueue(store, { trigger }).catch((err) => report('hubspot sync failed', err));
  } catch (err) {
    report('hubspot queue write failed', err);
  }
}
