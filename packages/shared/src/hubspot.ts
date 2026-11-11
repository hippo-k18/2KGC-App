/**
 * The HubSpot contact sync (T333): what the dashboard stores and shows. Plain
 * data, safe in a client component. The token itself never appears in any type
 * here; it lives encrypted in `integrations/hubspotSecret`, read only by
 * `@kgc/scripts/src/lib/hubspot-*` on a server.
 *
 * Every registration is one HubSpot contact, matched by email. Which of our
 * fields go to which HubSpot property is the organizer's choice; anything not
 * mapped is not sent.
 */

/** A field of ours that can be sent. `email` is always sent: it is how HubSpot matches. */
export type HubspotSourceKey =
  | "firstName"
  | "lastName"
  | "company"
  | "jobTitle"
  | "ticketType"
  | "orderDate"
  | "amount"
  | "attendance"
  | "promoCode"
  | "checkedIn"
  | "registrationStatus";

/** What kind of value a field holds, which decides which HubSpot properties it may go to. */
export type HubspotValueKind = "string" | "date" | "number" | "bool";

export interface HubspotSourceField {
  key: HubspotSourceKey;
  label: string;
  kind: HubspotValueKind;
  /** The HubSpot property suggested when nothing is mapped yet ("" = skip). */
  suggested: string;
  /** Shown under the field on the mapping screen. */
  hint: string;
}

export const HUBSPOT_SOURCE_FIELDS: readonly HubspotSourceField[] = [
  { key: "firstName", label: "First name", kind: "string", suggested: "firstname", hint: "The first word of the attendee name." },
  { key: "lastName", label: "Last name", kind: "string", suggested: "lastname", hint: "The rest of the attendee name." },
  { key: "company", label: "Company", kind: "string", suggested: "company", hint: "From the registration." },
  { key: "jobTitle", label: "Job title", kind: "string", suggested: "jobtitle", hint: "From the registration." },
  { key: "ticketType", label: "Ticket type", kind: "string", suggested: "", hint: "For example Main Conference." },
  { key: "orderDate", label: "Order date", kind: "date", suggested: "", hint: "The day the ticket was bought." },
  { key: "amount", label: "Amount paid", kind: "number", suggested: "", hint: "In dollars, after discounts, before refunds." },
  { key: "attendance", label: "In person or virtual", kind: "string", suggested: "", hint: "In person or Virtual, from the ticket type." },
  { key: "promoCode", label: "Promo code", kind: "string", suggested: "", hint: "The code used at checkout, if any." },
  { key: "checkedIn", label: "Checked in", kind: "bool", suggested: "", hint: "Whether the badge has been scanned at the event." },
  { key: "registrationStatus", label: "Registration status", kind: "string", suggested: "", hint: "Registered, Refunded, Cancelled or Transferred." },
];

/** "Fill only empty fields" leaves anything already in HubSpot alone; "always overwrite" replaces it. */
export type HubspotUpdateMode = "fill-empty" | "overwrite";

/** What the dashboard saves in `integrations/hubspot`. No token. */
export interface HubspotConfig {
  /** Sync runs only when true and a token is saved. */
  enabled: boolean;
  /** Source key to HubSpot property name; a missing or "" entry is not sent. */
  mapping: Partial<Record<HubspotSourceKey, string>>;
  mode: HubspotUpdateMode;
  /** Create a contact for a registrant HubSpot does not have yet (Whova's toggle). */
  createContacts: boolean;
  /** Set Lifecycle stage to Lead on a contact that has no stage yet. */
  setLeadStage: boolean;
  /** The last four characters of the saved token, for the masked display. */
  tokenLast4?: string;
  /** The HubSpot account the token belongs to, from the test connection. */
  portalId?: number;
  connectedAt?: number;
  connectedBy?: string;
  /** Set when HubSpot refused the token during a sync; cleared by a good test or a new token. */
  tokenRejectedAt?: number;
  /** Set when this server could not decrypt the saved token (its WEB_ORDER_SECRET differs); not HubSpot's refusal. */
  tokenUnreadableAt?: number;
  updatedAt?: number;
  updatedBy?: string;
  /** HubSpot type of each mapped property, saved with the mapping so a sync need not list properties. */
  propertyTypes?: Record<string, string>;
}

export const HUBSPOT_CONFIG_DEFAULT: HubspotConfig = {
  enabled: false,
  mapping: Object.fromEntries(
    HUBSPOT_SOURCE_FIELDS.filter((f) => f.suggested).map((f) => [f.key, f.suggested]),
  ) as Partial<Record<HubspotSourceKey, string>>,
  mode: "fill-empty",
  createContacts: true,
  setLeadStage: true,
};

/** A contact property as the mapping screen needs it, from HubSpot's property list. */
export interface HubspotPropertyOption {
  name: string;
  label: string;
  type: string;
  fieldType: string;
  groupName: string;
  /** HubSpot's own property rather than one somebody created; only a few of these are offered. */
  hubspotDefined?: boolean;
}

/** Why a contact was queued. */
export type HubspotTrigger = "order" | "refund" | "change" | "checkin" | "backfill" | "retry";

/**
 * `hubspotQueue/{personKey}`: a person waiting to be sent, keyed by their
 * normalised email (`hubspotPersonKey`), because a HubSpot contact is a person
 * and one person can hold several tickets.
 */
export interface HubspotQueueItem {
  email: string;
  triggers: HubspotTrigger[];
  enqueuedAt: number;
  attempts: number;
  /** ms; a person who has failed for good is parked far in the future. */
  nextAttemptAt: number;
  lastError?: string;
  failed?: boolean;
}

/** `integrations/hubspot/runs/{id}`: one pass of the sync, for the log. */
export interface HubspotRun {
  startedAt: number;
  finishedAt: number;
  /** What started it: a trigger, "manual" for Sync all now, "cron" for the retry timer. */
  trigger: HubspotTrigger | "manual" | "cron";
  actor: string;
  sent: number;
  created: number;
  updated: number;
  /** Not sent on purpose: not in HubSpot and "create contacts" is off, or nothing to change. */
  skipped: number;
  failed: number;
  /** One line per failed or skipped contact (or per bad queue entry), capped. */
  errors: { email: string; message: string }[];
  /** Set when the whole run stopped (bad token, HubSpot down). */
  stopped?: string;
}

export const HUBSPOT_RUNS_KEPT = 50;
export const HUBSPOT_MAX_ATTEMPTS = 8;
