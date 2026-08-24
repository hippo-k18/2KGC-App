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
 */

export interface Gap {
  whova: string;
  needs: string;
  size?: string;
  refs?: string;
}

export const GAPS: Record<string, Gap> = {
  'content/branding-center/app-branding': {
    whova:
      'Sets the event brand colour, a 256×256 logo, a 750×300 banner and an optional 2000×750 web-app header. Fonts are explicitly not customisable.',
    needs:
      'A settings document, Storage uploads with server-side resizing, and a theme read in the Expo app. The app currently reads its palette from constants/theme.ts at build time, so this is the piece that has to change first.',
    size: '2–3 days, most of it the image pipeline',
  },
  'content/agenda-center/conflict-check': {
    whova:
      'A rules dashboard that flags double-booked speakers and rooms, plus custom conflict rules an organizer defines.',
    needs:
      'Nothing new in the data model — a pass over the sessions already loaded by Session Manager finds both classes. This is the cheapest genuinely useful thing on the unbuilt list.',
    size: '1–2 days',
  },
  'content/agenda-center/session-qanda-manager': {
    whova:
      'Enables or disables Q&A per session and assigns per-session moderators, whose powers are exactly three: hide a question, pin it, mark it answered.',
    needs:
      'The Q&A board and questions subcollections exist and the app renders them. The blocker is the aggregate trigger for upvote counts, which needs the Blaze plan.',
    refs: 'AGENTS.md, "Known gaps" — the seven unbuilt triggers',
  },
  'content/speaker-center/message-speakers': {
    whova:
      'Templated bulk email to speakers with scheduling, targeting (by role, or "speakers with incomplete profiles"), drafts and a sent log.',
    needs:
      'An email sender. There is none anywhere in this project yet — no transactional provider, no templates, no suppression list, no bounce handling.',
    size: '4–6 days for the first one, then a day each for Sponsors and Exhibitors',
  },
  'content/call-for-speakers-abstracts': {
    whova:
      'A public submission portal, a submissions dashboard, reviewer assignment and accept/reject decisions with notification. The submission form locks after the first submission.',
    needs:
      'A second public surface with its own auth model, a review workflow, and a path from an accepted abstract into a session. It is a product, not a screen.',
    size: '15–20 days',
  },
  'content/exhibitor-center/exhibitor-manager': {
    whova:
      'Exhibitor records with booth staff, lead retrieval, compliance documents and a passport contest. Exhibitors self-serve via a personal link rather than a dashboard login.',
    needs:
      'An exhibitors collection, the personal-link portal pattern, and lead capture wired to the badge QR. The QR side is already built for check-in and would be reused.',
    size: '8–12 days',
  },
  'content/sponsor-center/sponsor-tiering': {
    whova:
      'Assigns sponsors to tiers and decides banner placement and sponsored sessions from those tiers.',
    needs:
      'SponsorDoc already carries a tier. What is missing is the placement rules and the banner surfaces in the app to place them on.',
    size: '2–3 days',
  },
  'content/documents-and-videos/documents': {
    whova:
      'Ten document slots on the basic package, 10 MB per file, PDF and PPTX only, attachable to sessions.',
    needs:
      'Storage rules and an upload UI. The sessions/{id}/materials subcollection is already modelled for exactly this.',
    size: '2 days',
  },
  'tickets/ticket-setup/1-1-create-tickets': {
    whova:
      'Ticket types with price, quantity, per-buyer limits, sales windows and audience type. Prices lock after the first sale.',
    needs:
      'ticketTypes and orders are modelled but nothing writes them. apps/web already takes money through Stripe Checkout, so the gap is the organizer-side editor and the link from a paid order to a registration.',
    size: '5–8 days',
    refs: 'apps/web is where the buying half already lives',
  },
  'tickets/ticket-setup/1-2-question-forms': {
    whova:
      'Per-ticket registration question forms whose answers become attendee Segments. The form locks after the first response.',
    needs:
      'A form builder, an answers store, and the segment derivation on top. Segments are the sharpest idea in Whova and they are downstream of this.',
    size: '6–9 days',
  },
  'tickets/orders-and-transactions/attendee-orders': {
    whova:
      'Order table with view, manual add, refund, resend confirmation and Excel export. Manual add supports check, cash, complimentary and "no payment necessary".',
    needs: 'The orders collection to actually be written by the Stripe webhook in apps/web.',
    size: '3–4 days once orders exist',
  },
  'attendees/segments': {
    whova:
      'Auto-generated cohorts derived from registration answers and add-on purchases, usable as targets for announcements, badges and check-in counts with no configuration.',
    needs:
      'Registration question answers to derive from — so this is blocked behind Question Forms, not behind anything of its own.',
    size: '3–4 days after question forms',
  },
  'attendees/name-badges': {
    whova:
      'A badge designer, up to ten templates, segments printable on the badge, and a list of compatible printers. On-demand printing at check-in is a separate add-on.',
    needs:
      'badgeTemplates and badgePrintJobs are modelled and nothing writes them. The check-in scan that would trigger a print already works.',
    size: '6–10 days including a print path that survives a conference hall',
  },
  'attendees/check-in-and-checkout/kiosk-check-in': {
    whova: 'An iPad kiosk app with badge printing and a kiosk activity dashboard. Paid add-on.',
    needs:
      'The check-in write path is built and idempotent. A kiosk is a different client on top of it, plus the printer integration.',
    size: '5–8 days',
  },
  'attendees/check-in-and-checkout/self-check-in': {
    whova:
      'A self-check-in URL plus a printable QR poster attendees scan on arrival.',
    needs:
      'A public route that accepts a scan. Deliberately not built: firestore.rules denies every client write under checkInLists precisely so that attendees cannot check themselves in, and opening that is a decision rather than a feature.',
    refs: 'firestore.rules and AGENTS.md, "Security model"',
  },
  'attendees/admin-settings': {
    whova:
      'Admins (30 if the event is paid, 10 if not), check-in staff, an event invitation code and share/request templates. Admin roles are cosmetic — Whova states plainly that all admins have identical privileges regardless of the role selected.',
    needs:
      'Ours is CONSOLE_ALLOWLIST, a comma-separated env var, which is the right size for ten users but is not a screen. Real roles would need auth to land first.',
    size: '2 days, after SSO',
    refs: 'DECISIONS.md #5 — Google SSO with enforced MFA',
  },
  'attendees/certificates': {
    whova:
      'Attendance certificates: 1/10/10 templates by package, 500/1000/3000 sends. Often the CPE or CE requirement that makes an event billable.',
    needs: 'A template renderer, a PDF pipeline and an email sender.',
    size: '4–6 days',
  },
  'engagement/surveys': {
    whova:
      'Surveys from scratch, from a template, from a question bank, imported from a Google Form, or reused from a past event. Locks after the first response.',
    needs: 'A form builder and a response store — the same two things Question Forms needs.',
    size: 'shares most of its cost with question forms',
  },
  'engagement/live-polling': {
    whova:
      'Polls scheduled against a session, optionally anonymous, with a live presentation link for the room screen. Limited to 20 polls per session.',
    needs:
      'The polls and votes subcollections exist and the app renders them. Tallies are function-owned and the trigger needs Blaze, so the numbers never move today.',
    refs: 'AGENTS.md, "Known gaps"',
  },
  'engagement/gamification': {
    whova:
      'Leaderboard, photo, icebreaker and trivia contests, with settings reusable from a past event. The leaderboard contest locks at publish.',
    needs: 'A points model and the triggers to accumulate it. Blaze again.',
    size: '4–6 days after Blaze',
  },
  'engagement/floormap': {
    whova:
      'An uploaded floormap with pinned agenda locations and exhibitor booth numbers. Attendee-uploaded maps go through organizer review.',
    needs: 'An image, a pin editor and coordinates on rooms. RoomDoc has no geometry yet.',
    size: '3–5 days',
  },
  'engagement/1-1-meeting-scheduler': {
    whova: 'Meeting blocks with configurable slot durations that attendees book against each other.',
    needs:
      'Availability, slots, booking with a race-free write, and a cancellation path. The messaging half already exists.',
    size: '5–7 days',
  },
  'marketing/event-website': {
    whova:
      'Twenty-plus templates, drag-reorderable sections, a countdown and a registration button.',
    needs:
      'apps/web already is the event website, hand-built. A template system is only worth it across many events, and this is one event.',
    refs: 'a deliberate non-goal — see DECISIONS.md',
  },
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
  'pay/balance': {
    whova:
      'What the organizer owes Whova, distinct from ticket money. Card, check or wire; US sales tax by billing address; publish is gated on the balance being zero.',
    needs: 'Nothing. This tab exists because Whova needs to be paid, and we are not Whova.',
    refs: 'kept in the nav for fidelity — it will stay empty',
  },
  publish: {
    whova:
      'Pay, then publish. Whova gates publishing on two hard conditions: the event is paid for, and it is within 90 days of the start date. Un-publishing is not self-serve — it requires emailing support. Event dates lock at publish.',
    needs:
      'An event lifecycle state on the event document, plus whatever the app should do differently before it. Today everything is always live.',
    size: '2–3 days',
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
