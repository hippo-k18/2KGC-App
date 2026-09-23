/**
 * Exhibitor lead capture: the consent wording, and the file it comes out as.
 *
 * ── Why the wording is a function and not a string in a component ───────────
 *
 * `ExhibitorLeadDoc.consent.wording` stores the exact sentence the attendee was
 * shown, for the same reason `ConsentFormDoc` stores its body and hashes it:
 * "they consented" is worth nothing without what they consented to. A sentence
 * that lives in JSX is a sentence that gets reworded in a tidy-up, and every
 * lead recorded before that edit then claims agreement to wording nobody ever
 * saw. It is built here, shown by the page, and written with the record, so all
 * three are one string.
 *
 * ── Why the export is built here too ────────────────────────────────────────
 *
 * The exhibitor downloads it from the website and an organizer may need the
 * same file from the dashboard, and those two cannot import each other. The
 * columns are the promise made on the consent line: name, company, title,
 * email, when, and the note the booth typed. Nothing else about the attendee
 * exists in a lead record, which is the point — see `ExhibitorLeadDoc`.
 *
 * Plain TypeScript: no Firestore import, no React. Tested in
 * `leads-core.test.ts`.
 */

import { toCsv } from "./csv-core.js";

/**
 * What the attendee is asked, in their own second person.
 *
 * ⚠️ Changing this sentence changes what future leads record and nothing about
 * past ones, which is correct and is the reason it is pinned by a test. If it
 * has to change, it changes for new scans only.
 */
export function leadConsentWording(exhibitorName: string): string {
  const who = exhibitorName.trim() || "this exhibitor";
  return `Share your name, company, job title and email address with ${who}. They can contact you about their products after the conference.`;
}

/** One lead, as far as the export and the list on screen are concerned. */
export interface LeadRow {
  registrationId: string;
  name: string;
  email: string;
  company?: string;
  title?: string;
  note?: string;
  /** Epoch ms. Formatted by the caller, because only it knows the zone. */
  scannedAtMs?: number;
}

/**
 * `2027-05-06 11:04` in the event's zone, or empty.
 *
 * The exporter's own formatting rather than `toLocaleString`, so the file a
 * booth downloads in Berlin and the file the organizer downloads in New York
 * carry the same instant written the same way. A lead list sorted by a column
 * that means two different things in two copies of the file is worse than one
 * with no times at all.
 */
export function leadTimestamp(ms: number | undefined, timeZone: string): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(ms));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const hour = get("hour") === "24" ? "00" : get("hour");
    return `${get("year")}-${get("month")}-${get("day")} ${hour}:${get("minute")}`;
  } catch {
    // An unknown zone string is a configuration fault, not a reason to refuse
    // somebody their leads. UTC, and the header says the zone.
    return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
  }
}

export function leadsCsv(rows: LeadRow[], timeZone: string): string {
  return toCsv(rows, [
    { header: "Name", value: (r) => r.name },
    { header: "Company", value: (r) => r.company ?? "" },
    { header: "Job title", value: (r) => r.title ?? "" },
    { header: "Email", value: (r) => r.email },
    { header: `Scanned (${timeZone})`, value: (r) => leadTimestamp(r.scannedAtMs, timeZone) },
    { header: "Note", value: (r) => r.note ?? "" },
  ]);
}

/**
 * What the booth typed, trimmed and capped.
 *
 * 500 characters because it is a line about a conversation ("wants the
 * healthcare demo, cc their architect"), not a CRM record, and an unbounded
 * text field on a page reachable with one forwarded link is a document size
 * anybody can choose. Returning null rather than an empty string so the caller
 * can delete the field instead of storing a blank one — AGENTS.md gotcha 9.
 */
export function normaliseLeadNote(raw: string): string | null {
  const trimmed = raw.replace(/\s+$/g, "").replace(/^\s+/g, "");
  if (!trimmed) return null;
  return trimmed.slice(0, 500);
}

/**
 * The scanned string, as the badge holds it.
 *
 * The badge QR is `qrSecret` alone — no envelope, no prefix, no URL (see the
 * header of `app/src/lib/data/badge.ts`). So there is nothing to parse, and the
 * only job here is to refuse the shapes that are obviously not a badge before
 * they become a Firestore query: a scanner that picks up a poster's URL, or an
 * empty frame.
 *
 * Length rather than meaning, because the two shapes go to different lookups:
 * `qrSecret` is `randomBytes(24)` base64url, so 32 characters of
 * `[A-Za-z0-9_-]`, and `claimCode` is six characters of a reduced alphabet
 * printed under the QR. Anything else is refused with a sentence the booth can
 * act on, rather than becoming a query that finds nothing.
 *
 * ⚠️ `claimCode` is folded up and `qrSecret` is not. `qrSecret` is compared
 * exactly — it is random and case-carrying, and folding it would throw away a
 * bit per character for no benefit. The check-in desk makes the same
 * distinction, in `matchRegistration`.
 */
export function readScannedCode(raw: string): { kind: "badge" | "claim"; code: string } | null {
  const code = raw.trim();
  if (!code) return null;
  if (/^[A-Za-z0-9_-]{24,128}$/.test(code)) return { kind: "badge", code };
  if (/^[A-Za-z0-9]{6}$/.test(code)) return { kind: "claim", code: code.toUpperCase() };
  return null;
}
