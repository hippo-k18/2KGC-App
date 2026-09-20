/**
 * The notice an attendee gets when a session they saved moves.
 *
 * ── Why the id is derived and not generated ─────────────────────────────────
 *
 * Two things write this notice. The dashboard writes it in the server action
 * that made the change, because that is the only writer that exists today —
 * `onSessionAgendaChange` cannot be deployed until the IAM grant in
 * `OWNER-ACTIONS.md` §3 lands. The trigger writes it because it also catches a
 * CSV import and a script, which the dashboard's action does not see.
 *
 * On the day both are live, both fire for the same edit. A generated id makes
 * that two notifications on one phone about one room change; an id derived from
 * *where the session ended up* makes it one `set()` over another, which is the
 * same trick `checkIns` uses — the duplicate is not detected and resolved, it is
 * simply unrepresentable.
 *
 * So the id names the resulting state, not the change: a session moved to room
 * B at 14:00 has one notice however many writers say so, and a later move to
 * 15:00 is a different state and therefore a second notice, which is right.
 */

/** Which agenda facts moved. Ordered, so the id and the sentence are stable. */
export type AgendaChange = "day" | "time" | "room";

const ORDER: AgendaChange[] = ["day", "time", "room"];

/** Firestore ids may not contain `/`; everything else here is defensive. */
function slug(value: string): string {
  return (value || "none").replace(/[^A-Za-z0-9]+/g, "-").slice(0, 60);
}

export function agendaNoticeId(input: {
  sessionId: string;
  startsAtLocal: string;
  roomId?: string | null;
  cancelled?: boolean;
}): string {
  const state = input.cancelled
    ? "cancelled"
    : `${slug(input.startsAtLocal)}_${slug(input.roomId ?? "")}`;
  return `agenda_${slug(input.sessionId)}_${state}`;
}

/** `['room', 'time']` → `time and room`, in a fixed order. */
export function describeAgendaChanges(changed: AgendaChange[]): string {
  const ordered = ORDER.filter((c) => changed.includes(c));
  if (ordered.length <= 1) return ordered[0] ?? "";
  if (ordered.length === 2) return `${ordered[0]} and ${ordered[1]}`;
  return `${ordered.slice(0, -1).join(", ")} and ${ordered[ordered.length - 1]}`;
}

/**
 * The sentence on the phone.
 *
 * It names the session and what moved, and stops. The new time and room are one
 * tap away on the session itself, and a notice that repeats them is a notice
 * that can be out of date the moment it is written — the organizer who moved a
 * talk twice in a minute would leave the first sentence standing as a fact.
 */
export function agendaNoticeBody(input: {
  title: string;
  changed: AgendaChange[];
  cancelled?: boolean;
}): string {
  if (input.cancelled) return `${input.title} has been cancelled.`;
  const what = describeAgendaChanges(input.changed);
  if (!what) return `${input.title} has changed.`;
  return `${input.title}: the ${what} changed. Check the new details.`;
}
