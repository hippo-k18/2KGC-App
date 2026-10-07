/**
 * Which tiers were sold watching, and therefore cannot be locked out of it.
 *
 * ── Why this reads the bullets and not one flag ─────────────────────────────
 *
 * `includesVideoLibrary` was doing this job on its own, and it got the one tier
 * that is sold on nothing else wrong. `Virtual` is $349, is not in the room at
 * all, carries the flag as `false`, and its first two bullets are "Live streams
 * of every conference and workshop session" and "On-demand replays for at least
 * a month afterwards". So restricting a recording restored four other tiers and
 * left the remote buyer out, and restricting a stream restored nobody — on the
 * stated ground that no tier's bullets promise a live stream, which that tier's
 * own bullets contradict.
 *
 * The flag is not wrong; it is narrow. It is the machine-readable half of one
 * sentence ("Three months of the KGC Video Library") and it became load-bearing
 * for a different question. What a buyer is owed is what the tier said it was
 * selling, and the tier says that in its bullet list, which is the text the
 * tickets page renders and the thing somebody paid against.
 *
 * So both are read: the flag still guarantees a recording, and a bullet
 * promising live viewing guarantees a stream. A tier that promises neither can
 * still be excluded, which is the whole point of the control.
 *
 * ── Why the phrases are narrow ──────────────────────────────────────────────
 *
 * A loose match is worse than no match, because it takes the organizer's
 * control away for a reason nobody can see. "The Friday watch party" contains
 * the word watch and promises no video; "One Main Conference pass for booth
 * staff" names a tier that does include recordings and promises the exhibitor
 * a person in a room. Neither matches below, and both are real lines in the
 * catalogue this file is read against.
 *
 * Plain TypeScript: no Firestore import, no React. Tested in
 * `watch-promise-core.test.ts`.
 */

/** A stream is watched as it happens; a recording is watched afterwards. */
export type WatchKind = "stream" | "recording";

/** The parts of a ticket tier this question needs. Deliberately not the document. */
export interface WatchPromiseTier {
  name: string;
  /** The flat bullet list under the price. */
  includes?: string[];
  /** The same contents, grouped as the headline panels group them. */
  groups?: { heading: string; items?: string[] }[];
  /** "Three months of the KGC Video Library", as a boolean. Recordings only. */
  includesVideoLibrary?: boolean;
}

/**
 * Phrases that promise watching a session as it happens.
 *
 * "on demand" is deliberately absent: Main Conference sells "every conference
 * session, streamed on demand", which is a recording and is sold as one. A
 * seat at the live stream is a different thing and that tier does not claim it.
 */
const STREAM_PHRASES = [
  "live stream",
  "streamed live",
  "streaming live",
  "streams live",
  "watch live",
  "live broadcast",
];

/** Phrases that promise watching it afterwards. */
const RECORDING_PHRASES = [
  "recording",
  "on demand",
  "on-demand",
  "replay",
  "video library",
];

/** Every line of copy a tier sells itself with, flattened. */
function tierLines(tier: WatchPromiseTier): string[] {
  const lines = [...(tier.includes ?? [])];
  for (const group of tier.groups ?? []) {
    if (group.heading) lines.push(group.heading);
    lines.push(...(group.items ?? []));
  }
  return lines.map((l) => l.toLowerCase());
}

/** Whether this tier's own copy, or its flag, promises this kind of watching. */
export function tierPromisesWatching(tier: WatchPromiseTier, kind: WatchKind): boolean {
  if (kind === "recording" && tier.includesVideoLibrary === true) return true;
  const phrases = kind === "stream" ? STREAM_PHRASES : RECORDING_PHRASES;
  return tierLines(tier).some((line) => phrases.some((p) => line.includes(p)));
}

/**
 * The names of every tier that cannot be excluded from this kind of watching.
 *
 * Names rather than ids, because the restriction is expressed in the names
 * `RegistrationDoc.ticketType` carries and `firestore.rules` compares.
 */
export function tiersPromisedWatching(
  tiers: WatchPromiseTier[],
  kind: WatchKind,
): string[] {
  return tiers
    .filter((t) => typeof t.name === "string" && t.name.trim() !== "")
    .filter((t) => tierPromisesWatching(t, kind))
    .map((t) => t.name)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * What an organizer ticked, widened by what was already sold.
 *
 * An empty pick already means everybody, so this only ever touches a real
 * restriction and only ever widens one. `restored` is what the screen says out
 * loud, because a control that quietly does something else is the thing an
 * organizer stops trusting.
 */
export function withPromisedTiers(
  picked: string[],
  promised: string[],
): { allowed: string[]; restored: string[] } {
  if (picked.length === 0) return { allowed: [], restored: [] };
  const restored = promised.filter((n) => !picked.includes(n));
  return { allowed: [...picked, ...restored], restored };
}

/** "A, B and C". A list in a sentence somebody reads, not a join. */
export function andList(names: string[]): string {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (clean.length <= 1) return clean[0] ?? "";
  return `${clean.slice(0, -1).join(", ")} and ${clean[clean.length - 1]!}`;
}
