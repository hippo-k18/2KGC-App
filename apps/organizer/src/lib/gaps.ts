/**
 * What Whova actually does on the screens we have not built.
 *
 * The catch-all route renders one of these instead of an empty table. The point
 * is that an organizer evaluating the move can click any nav item and get a
 * straight answer — "Whova does X, we would need Y, that is roughly Z" — rather
 * than a spinner or a lie. An empty state that implies "this half-works" is
 * worse than one that names the gap.
 *
 * Facts in the `whova` column come from Whova's help centre for organizers
 * (~927 articles, category 200388597) and are quoted or paraphrased closely,
 * limits included, because the limits are the part that decides whether a
 * feature is usable. Sizes come from §34 of
 * `whova-rebuild/research/02-organizer-backend.md`, which estimates them.
 *
 * Not exhaustive on purpose — a path with no entry falls back to a generic note
 * in the catch-all. Add one when you have actually read what the real screen
 * does; a guessed entry here is worse than no entry.
 *
 * ── This shrank a lot on 2026-08-26, and what is left is the interesting part ─
 *
 * Twenty-four entries described screens that have since been built, and a note
 * explaining why a working screen does not exist is worse than no note — the
 * catch-all would never render them, so they were pure decay waiting to mislead
 * whoever read this file next.
 *
 * Every leaf path in `nav.ts` now has a real screen file, so **nothing in this
 * record is currently reachable**. It is kept, rather than deleted, because the
 * catch-all still serves any path added to the nav before its screen exists,
 * and that is exactly the moment an honest note is worth having.
 */

export interface Gap {
  whova: string;
  needs: string;
  size?: string;
  refs?: string;
}

export const GAPS: Record<string, Gap> = {
  'marketing/event-webpages/agenda-webpage': {
    whova:
      'A public agenda page in general-purpose and special-purpose flavours (by day, by track, for remote attendees), a printable PDF, a sessions-to-exclude list and per-page analytics.',
    needs:
      'A public read of the same sessions the console already lists. This is one of the cheapest high-visibility wins left.',
    size: '2–3 days',
  },
  'virtual-and-hybrid/online-session-manager': {
    whova:
      'Streaming setup per session, rehearsal sessions, and Zoom / Microsoft Teams integrations.',
    needs:
      'SessionDoc has a format field and nothing else. KGC 2027 is in-person at Cornell Tech, so this is sequenced last on purpose rather than being cheap.',
  },
  'tools/app-adoption': {
    whova:
      'App adoption email, five download-button styles, a web-app link, social graphics and a printable QR poster.',
    needs: 'An email sender, and the app to exist in the stores. Both are sequenced after the demo.',
  },
  'tools/moderator-tools': {
    whova: 'Moderation queues for session chats, the community board, photos and session Q&A.',
    needs:
      'The community board is built and unmoderated. A hide flag plus a queue over communityPosts is small and would matter the first time it matters.',
    size: '2–3 days',
  },
};
