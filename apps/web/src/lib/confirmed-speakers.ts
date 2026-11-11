/**
 * Who the public `/speakers` page lists (T304), as a pure function so the rule
 * is tested rather than described.
 *
 * ── A speaker is confirmed when all of these hold ────────────────────────────
 *
 *   1. **Listed.** `unlisted !== true`. The call for papers creates a speaker
 *      unlisted the moment a submission is accepted, and Speaker Manager clears
 *      it when the organizer is ready to announce them (T249).
 *   2. **On the published programme.** At least one session that is
 *      `published` and not deleted names them in its `speakerIds`. A draft
 *      session is not a promise to anybody, and a speaker whose only talk was
 *      withdrawn has nothing to be announced for.
 *   3. **Named.** A record with a blank name is a half-made document, not a
 *      person.
 *
 * The session's `speakerIds` is the link, not `SpeakerDoc.sessionIds`, because
 * that is the side the agenda and its session pages read. If the two ever
 * disagree, this page agrees with `/agenda/<id>`.
 *
 * There is no separate "approved profile" flag to check: what a speaker types
 * into their own profile link waits as a draft until an organizer approves it,
 * so the bio and title on the speaker record are already the approved ones.
 *
 * No server imports: the tests run this without Firestore.
 */

/** One talk, as a speaker card shows it. */
export interface SpeakerTalk {
  id: string;
  title: string;
  description?: string;
  format?: string;
  /** `YYYY-MM-DD` in the event's zone. */
  day?: string;
  /** `YYYY-MM-DDTHH:mm` wall clock in the event's zone. */
  startsAtLocal?: string;
}

/** The fields of a session the rule reads. */
export interface ProgrammeSession extends SpeakerTalk {
  status?: string;
  deletedAt?: unknown;
  speakerIds?: string[];
}

/** The fields of a speaker the rule reads. Anything else is passed through. */
export interface RosterSpeaker {
  id: string;
  name: string;
  unlisted?: boolean;
  featured?: boolean;
}

export type ConfirmedSpeaker<S extends RosterSpeaker> = S & { talks: SpeakerTalk[] };

/** A session the public site may show: published and not soft-deleted. */
export function isPublicSession(s: { status?: string; deletedAt?: unknown }): boolean {
  return s.status === 'published' && !s.deletedAt;
}

/**
 * The confirmed speakers, featured first, each with their talks in programme
 * order.
 *
 * `speakers` keeps its incoming order within each half, so the roster order an
 * organizer set (`displayOrder`, then surname, from `listSpeakers()`) survives.
 * Sessions that are not public are ignored here as well as upstream, so a
 * caller that passes the raw collection still gets the right answer.
 */
export function confirmSpeakers<S extends RosterSpeaker>(
  speakers: S[],
  sessions: ProgrammeSession[],
): ConfirmedSpeaker<S>[] {
  const talksBySpeaker = new Map<string, SpeakerTalk[]>();
  for (const s of sessions) {
    if (!isPublicSession(s)) continue;
    const talk: SpeakerTalk = {
      id: s.id,
      title: s.title,
      description: s.description,
      format: s.format,
      day: s.day,
      startsAtLocal: s.startsAtLocal,
    };
    for (const id of new Set(s.speakerIds ?? [])) {
      const list = talksBySpeaker.get(id);
      if (list) list.push(talk);
      else talksBySpeaker.set(id, [talk]);
    }
  }

  const confirmed = speakers
    .filter((s) => s.unlisted !== true && s.name?.trim() && talksBySpeaker.has(s.id))
    .map((s) => ({
      ...s,
      // A fixed-width wall-clock string, so a string compare is a time compare.
      talks: [...talksBySpeaker.get(s.id)!].sort(
        (a, b) =>
          (a.startsAtLocal ?? '').localeCompare(b.startsAtLocal ?? '') ||
          a.title.localeCompare(b.title),
      ),
    }));

  return [...confirmed.filter((s) => s.featured), ...confirmed.filter((s) => !s.featured)];
}
