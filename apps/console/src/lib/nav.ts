/**
 * Whova's organizer dashboard information architecture, as data.
 *
 * This is a transcription of §1 of `whova-rebuild/research/02-organizer-backend.md`
 * ("Dashboard information architecture"), which was reconstructed from ~900
 * help-centre navigation paths. The section names, the nesting and the order are
 * Whova's, not ours. **Do not rename a node to something clearer and do not
 * flatten a level because it looks redundant** — the entire point is that an
 * organizer who has used Whova finds things where they expect them. If a name
 * reads oddly (`Whova Listing`, `1.7 Registration Settings`), that oddness is
 * faithful and the placeholder text is where the explanation goes.
 *
 * Three kinds of node:
 *
 *   `section`      a container. Renders an index of its children.
 *   `implemented`  a real screen backed by real Firestore data.
 *   `placeholder`  exists in the nav, renders an honest description of the gap.
 *
 * A placeholder is deliberately NOT a greyed-out table or a disabled button. An
 * empty state that implies "this half-works" is worse than one that says what is
 * missing, what it would cost and where to read the detail — so every
 * placeholder carries `whova` (what the real product does there), `needs` (what
 * this repo would have to grow), `size` (roughly how big, from §34 where the
 * research estimates it) and `refs` (§-numbers to look up).
 *
 * Routing: `src/app/(console)/[...slug]/page.tsx` resolves any path against this
 * tree, so every node below is reachable and nothing 404s. Implemented screens
 * are real files under the same route group, and Next.js gives a static segment
 * precedence over the catch-all, so they win automatically.
 */

export type NavKind = 'section' | 'implemented' | 'placeholder';

/**
 * The built screens, by name.
 *
 * Whova's paths are long because Whova's nesting is deep, and a deep path
 * spelled as a literal in six files is a rename waiting to go wrong — the same
 * argument `collections.ts` makes about collection names. `revalidatePath()` in
 * particular fails silently against a stale path: the write lands, the list
 * keeps showing the old value, and nothing anywhere reports an error.
 */
export const ROUTES = {
  basics: '/content/basics',
  sessionManager: '/content/agenda-center/session-manager',
  trackManager: '/content/agenda-center/track-manager',
  speakerManager: '/content/speaker-center/speaker-manager',
  sponsorManager: '/content/sponsor-center/sponsor-manager',
  attendees: '/attendees/manage-attendees/attendees',
  checkIn: '/attendees/attendee-check-in/check-in',
  announcements: '/engagement/announcements',
  warRoom: '/tools/war-room',
} as const;

export interface NavNode {
  /** One URL path segment. */
  slug: string;
  /** Whova's own label. */
  label: string;
  kind: NavKind;
  /** One line, shown in section indexes and under the page title. */
  note?: string;
  /** Placeholders: what the real Whova screen does. */
  whova?: string;
  /** Placeholders: what this repo would need — data model, dependency, Blaze. */
  needs?: string;
  /** Placeholders: rough effort, from §34 where it is estimated. */
  size?: string;
  /** §-numbers in `02-organizer-backend.md`. */
  refs?: string;
  /** True for screens that are ours, not Whova's. */
  ours?: boolean;
  children?: NavNode[];
}

/** Repeated verbatim in several placeholders; the constraint is the same one. */
const ESP =
  'An email service provider (Resend/Postmark/SES) with a verified sending domain, called from ' +
  'Cloud Functions — which means outbound HTTP, which means the Firebase **Blaze** plan. The ' +
  'project is on Spark today.';

const STRIPE =
  'Stripe, an order/payment state machine, and webhook handling — all of which need Cloud ' +
  'Functions and therefore **Blaze**. `models.ts` models `TicketTypeDoc`, `OrderDoc` and ' +
  '`EntitlementDoc` and says in a comment that ticketing stays external for 2027.';

export const NAV: NavNode[] = [
  // ───────────────────────────────────────────────────────────── Content ────
  {
    slug: 'content',
    label: 'Content',
    kind: 'section',
    note: 'Everything that ends up in the attendee app: the event itself, the agenda, the people and the companies.',
    children: [
      {
        slug: 'basics',
        label: 'Basics',
        kind: 'implemented',
        note: 'Event name, dates, timezone, venue. §4.1.',
        children: [
          {
            slug: 'project-management',
            label: 'Project Management',
            kind: 'placeholder',
            whova:
              'A "Get started" checklist, projects with tasks and due dates, and a team portal so the organising committee can see who owes what.',
            needs:
              'A `projects`/`tasks` model that does not exist in `packages/shared/src/models.ts`, plus a second class of user — committee members who are not Firestore organizers and have no console allowlist entry.',
            size:
              'Not estimated in §34. Call it 4–6 days, against a Trello board that costs nothing and that the committee already knows.',
            refs: '§1, §25',
          },
        ],
      },
      {
        slug: 'branding-center',
        label: 'Branding Center',
        kind: 'section',
        note: 'Colour, logo, banner, the branded URL and the app\'s resource buttons. §4.2–§4.4.',
        children: [
          {
            slug: 'app-branding',
            label: 'App Branding',
            kind: 'placeholder',
            whova:
              'One event brand colour, a 256×256 logo, a 750×300 banner and an optional 2000×750 web-app header. Fonts are explicitly not customisable — a hard ceiling Whova\'s reviewers complain about.',
            needs:
              'Firebase Storage uploads plus an `eventBranding` document. The Expo app reads its palette from `app/src/constants/theme.ts` at build time, so this is a two-sided change: the console would write it and the app would have to start reading it at runtime.',
            size: '2–3 days including the app side.',
            refs: '§4.2',
          },
          {
            slug: 'branded-event-url',
            label: 'Branded Event URL',
            kind: 'placeholder',
            whova:
              'Reserve a subdomain on whova.com and publish it; it rebrands the web app and the registration pages. Unpaid reservations expire in 14 days and the URL can never be changed once published.',
            needs:
              'Nothing. This is a paid add-on for a subdomain on the vendor\'s own domain. KGC owns knowledgegraph.tech and ships a native app, so the category does not exist here.',
            size: 'Zero, deliberately. Listed so the absence is a decision rather than an oversight.',
            refs: '§4.3',
          },
          {
            slug: 'web-app-speaker-page',
            label: 'Web App Speaker Page',
            kind: 'placeholder',
            whova: 'Six banner styles and a speaker-card style for the web app\'s speaker page.',
            needs:
              'A web app. There isn\'t one — AGENTS.md is explicit that the Next.js version was replaced by Expo in July 2026 and that advice referring to it is describing the dead version. This console is the only web surface.',
            size: 'Not applicable until a public web app exists.',
            refs: '§4.2, §1',
          },
          {
            slug: 'customize-resources',
            label: 'Customize Resources',
            kind: 'placeholder',
            whova:
              'Up to five custom resource buttons with a 10-character label limit, drag-to-reorder, except for fixed defaults (Leaderboard, Photos, Session Q&A). Resource visibility is derived from data presence rather than toggled, which generates its own support burden.',
            needs:
              'A `resources` collection and dynamic tab rendering in Expo. The app\'s tabs are declared statically with `NativeTabs` in `(tabs)/_layout.tsx` and each icon must be specified twice (AGENTS.md gotchas 2 and 3), so data-driven buttons are a real change, not a config write.',
            size: '3–4 days.',
            refs: '§4.4',
          },
        ],
      },
      {
        slug: 'agenda-center',
        label: 'Agenda Center',
        kind: 'section',
        note: 'Whova\'s most actively developed area — 40 help articles. §11.',
        children: [
          {
            slug: 'session-manager',
            label: 'Session Manager',
            kind: 'implemented',
            note: 'The agenda. Every session, every status, editable. §11.',
          },
          {
            slug: 'track-manager',
            label: 'Track Manager',
            kind: 'implemented',
            note: 'The tracks sessions are cross-listed into. §11.4.',
          },
          {
            slug: 'session-qa-manager',
            label: 'Session Q&A Manager',
            kind: 'placeholder',
            whova:
              'Q&A is auto-enabled for any session that has a speaker; the toggle only exists to opt out. Per session ⋮ → Enable/Disable Q&A. You cannot disable it on a session that already has questions. Session Q&A moderators (name + email + sessions) get hide, pin and mark-as-answered powers in the app.',
            needs:
              '`SessionDoc.qaEnabled` already exists and is seeded, so the toggle itself is one field write and about half a day. The rest is not: a moderator is a new role in the `roles` custom claim and a change to `firestore.rules`, and reading the `questions` subcollection needs a collection-group query. Note that `upvoteCount` on a question is function-owned (DECISIONS.md D2) — the console must never write it.',
            size: '§34: Session Q&A + moderation, 5–7 days. The enable/disable toggle alone is ~0.5 days.',
            refs: '§11.11, §22.1, §22.2',
          },
          {
            slug: 'conflict-check',
            label: 'Conflict Check',
            kind: 'placeholder',
            whova:
              'A linter, run out of band. You upload a draft agenda spreadsheet and it reports double-booked speakers and double-booked rooms, plus optional custom rules (speaker availability, room availability, must-not-run-concurrently, preferred time windows). It explicitly does not touch live sessions — you fix the spreadsheet and re-upload until clean.',
            needs:
              'Nothing external. The entity graph is already in Firestore: `sessions` carries `speakerIds`, `roomId` and both wall-clock times. A live check that runs against the real agenda at save time is strictly better than Whova\'s file-based one and is not much harder.',
            size:
              '§34: live constraint validation 8–12 days — but a double-booked speaker/room query is 1–2 days and gets 80% of the value. That is the version worth building.',
            refs: '§11.8',
          },
        ],
      },
      {
        slug: 'speaker-center',
        label: 'Speaker Center',
        kind: 'section',
        note: 'Speaker records and speaker comms. §7.',
        children: [
          {
            slug: 'speaker-manager',
            label: 'Speaker Manager',
            kind: 'implemented',
            note: 'The speaker list, with profile completeness. §7.1–§7.3.',
          },
          {
            slug: 'message-speakers',
            label: 'Message Speakers',
            kind: 'placeholder',
            whova:
              'Seven shipped templates (general update, request documents, release form, check-in, parking, registration, basic), mail-merge insert-field, scheduled send, send-myself-test, drafts and a sent archive. The targeting is the good part: all speakers, speakers of a given role, manually selected, or — best of all — speakers with incomplete profiles, sub-filtered by "missing photo" or "missing bio/affiliation/title".',
            needs:
              `${ESP} It also needs a speaker email address, and \`SpeakerDoc\` in \`models.ts\` has no email field at all — see the note on the Speaker Manager screen.`,
            size:
              '§34: email campaign machinery 8–12 days; deliverability setup itself is only 1–2 days and comes out better than Whova\'s (§18.5).',
            refs: '§7.5, §7.6, §18.3, §18.5',
          },
        ],
      },
      {
        slug: 'call-for-speakers',
        label: 'Call for Speakers/Abstracts',
        kind: 'placeholder',
        whova:
          'A full abstract-management product: submission portal with a locking form, a submissions dashboard, reviewer assignment and blind review, decisions, accept/reject notifications, confirmation tracking, and an export that bulk-imports accepted abstracts straight into the agenda.',
        needs:
          'A submission model, an external reviewer identity that is not a conference attendee, file storage, conflict-of-interest handling and a review rubric. None of it exists here.',
        size:
          '§34 calls this the most expensive module in the entire product: **30–45 days**, and says plainly do not build it for 2027. The recommendation is to keep EasyChair and write the ~2-day CSV importer that turns accepted submissions into sessions instead — a 30–43 day saving.',
        refs: '§12, §34.1, §35.1',
      },
      {
        slug: 'exhibitor-center',
        label: 'Exhibitor Center',
        kind: 'section',
        note:
          'Booths, booth staff and lead capture. Whova treats exhibitors as an entirely separate registration product from sponsors — §0. Whether KGC even has exhibitors is open question 5 in §37.',
        children: [
          {
            slug: 'exhibitor-manager',
            label: 'Exhibitor Manager',
            kind: 'placeholder',
            whova:
              'Booth records (company, logo, description, booth number, tier, documents), booth staff with their own passes, a self-service profile link, and a scheduled profile-reminder email that must be configured before you can add anyone.',
            needs:
              'There is no `exhibitors` collection in `models.ts` — sponsors exist, exhibitors do not. Adding one means a document shape, security rules, a seed, and app-side rendering.',
            size: '§34: exhibitor management + self-service profile, 4–6 days.',
            refs: '§8.2, §8.3, §8.4',
          },
          {
            slug: 'message-exhibitors',
            label: 'Message Exhibitors',
            kind: 'placeholder',
            whova:
              'Templated, schedulable email to all exhibitors, to main contacts and lead staff, by tier, or manually selected.',
            needs: ESP,
            size: 'Shares the campaign machinery: §34, 8–12 days once for every messaging surface.',
            refs: '§18.3',
          },
          {
            slug: 'passport-contest',
            label: 'Passport Contest',
            kind: 'placeholder',
            whova:
              'Attendees collect stamps by visiting booths; organizers set the required count and the prize. It exists to drive traffic to exhibitors who paid for it.',
            needs: 'The scan primitive (`scanEvents`, already modelled) plus a contest model and app UI.',
            size: '§34 buckets gamification (leaderboard, photo, trivia, icebreaker, passport) at 12–18 days and cuts it.',
            refs: '§8.7, §20.2',
          },
          {
            slug: 'outreach-campaigns',
            label: 'Outreach Campaigns',
            kind: 'placeholder',
            whova:
              'Lets an exhibitor email attendees through the platform, with speakers and VIPs excludable. Sold as an add-on.',
            needs: `${ESP} Plus a consent story: this is a third party emailing our attendee list.`,
            size: 'Not separately estimated in §34.',
            refs: '§8.8, §18.3',
          },
          {
            slug: 'exhibitor-trivia',
            label: 'Exhibitor Trivia',
            kind: 'placeholder',
            whova: 'A paid add-on: per-booth trivia questions attendees answer to earn points.',
            needs: 'The same contest machinery as Passport Contest.',
            size: 'Inside the 12–18 day gamification bucket §34 cuts.',
            refs: '§8.7, §20.2',
          },
          {
            slug: 'compliance-docs',
            label: 'Compliance Docs',
            kind: 'placeholder',
            whova:
              'Collect insurance certificates and similar paperwork from exhibitors. Unlimited Exhibitor Package only.',
            needs: 'Storage, per-exhibitor document status, and a chase workflow.',
            size: 'Not estimated in §34.',
            refs: '§8.8',
          },
        ],
      },
      {
        slug: 'sponsor-center',
        label: 'Sponsor Center',
        kind: 'section',
        note:
          'Whova\'s own distinction: sponsors buy brand visibility, exhibitors buy direct engagement. §9.1.',
        children: [
          {
            slug: 'sponsor-manager',
            label: 'Sponsor Manager',
            kind: 'implemented',
            note: 'The sponsor list, grouped by tier. §9.2.',
          },
          {
            slug: 'sponsor-tiering',
            label: 'Sponsor Tiering',
            kind: 'placeholder',
            whova:
              'Create tiers, then decide where each tier\'s banner appears — Home, Agenda, Profile, Web app. Attach sponsors to sessions (maximum three sponsors per session; a sponsor may sponsor unlimited sessions). Drag-to-reorder tiers, and that one ordering also controls the sponsor webpage and the event website.',
            needs:
              '`SponsorTier` in `models.ts` is a hard-coded union of five values (`diamond | platinum | gold | silver | startup`), so creating a tier is a code change, not a write. Banner placement needs rendering slots in the Expo app that do not exist. Sponsored sessions need a field on `SessionDoc`.',
            size: '§34: sponsor management (records, tiers, logos, placement) 4–5 days, mostly CRUD.',
            refs: '§9.3',
          },
          {
            slug: 'advanced-banners',
            label: 'Advanced Banners',
            kind: 'placeholder',
            whova:
              'A paid add-on that puts sponsor logos on the non-obvious high-traffic surfaces: announcements, the sign-in page, surveys, registration pages and confirmation emails. Up to ten sponsors rotate per slot. §9.4 notes this is the business model in one feature — every screen productised as sellable inventory.',
            needs: 'Banner slots in the app and in every email template, plus rotation and impression counting.',
            size: 'Not separately estimated. The impression count is the part sponsors actually buy (§23.4).',
            refs: '§9.4',
          },
          {
            slug: 'message-sponsors',
            label: 'Message Sponsors',
            kind: 'placeholder',
            whova: 'Templated, schedulable email to all sponsors, by tier, or manually selected.',
            needs: `${ESP} \`SponsorDoc\` also has no contact email field.`,
            size: 'Shares the campaign machinery: §34, 8–12 days once.',
            refs: '§18.3',
          },
          {
            slug: 'outreach-campaigns',
            label: 'Outreach Campaigns',
            kind: 'placeholder',
            whova: 'As for exhibitors: sponsors email attendees through the platform.',
            needs: `${ESP} Plus the same consent question.`,
            size: 'Not separately estimated in §34.',
            refs: '§8.8, §9',
          },
        ],
      },
      {
        slug: 'artifact-center',
        label: 'Artifact Center',
        kind: 'section',
        note: 'Posters, pitches and art galleries — presenter-owned mini-booths. §13.1.',
        children: [
          {
            slug: 'artifact-manager',
            label: 'Artifact Manager',
            kind: 'placeholder',
            whova:
              'Unlimited posters, each with one video, one livestream, two documents, a cover photo and 50 general photos. Presenters self-serve via a personal link; the invitation email goes to the primary contact only, who must forward it.',
            needs: 'An artifact model, storage, and a presenter portal — none of which exist.',
            size: '§34: artifact/poster centre + competition 10–15 days, and cuts it.',
            refs: '§13.1',
          },
          {
            slug: 'competition',
            label: 'Competition',
            kind: 'placeholder',
            whova:
              'Two modes — vote for the best poster, or rate each poster. Judges can be sponsors, speakers or all attendees. Only live during the event date range; it cannot be extended.',
            needs: 'A ballot model with one document per judge, for the same concurrency reason polls use one document per voter.',
            size: 'Inside the 10–15 day artifact bucket §34 cuts.',
            refs: '§13.1',
          },
          {
            slug: 'artifact-streaming',
            label: 'Artifact Streaming',
            kind: 'placeholder',
            whova:
              'An add-on requiring an account manager: live presentation from the poster. Notably there is no recording.',
            needs: 'A streaming vendor.',
            size: 'Cut in §34.',
            refs: '§13.1',
          },
        ],
      },
      {
        slug: 'fair-center',
        label: 'Fair Center',
        kind: 'section',
        note: 'Career, college, graduate, scholarship, club and summer-camp fairs. §13.2.',
        children: [
          {
            slug: 'fair-manager',
            label: 'Fair Manager',
            kind: 'placeholder',
            whova:
              'Pick a fair type, configure the employer form email, add companies manually or by Excel import, chase profile completion, and let attendees submit resumes or expressions of interest in the app.',
            needs: 'A company model distinct from sponsors and exhibitors, plus an application/resume flow.',
            size: 'Not estimated in §34; out of scope for a knowledge-graph research conference.',
            refs: '§13.2',
          },
        ],
      },
      {
        slug: 'logistics-center',
        label: 'Logistics Center',
        kind: 'placeholder',
        whova:
          'A small CMS for practical information — transportation, restaurants, hotels, parking — surfaced under app Resources. Also Whova\'s overflow valve once you have used your five custom resource buttons.',
        needs:
          'Very little. §35.1 says explicitly: logistics, FAQ and venue guidance are markdown files in the repo or a `logistics` sheet, and skipping the CMS saves ~4 days.',
        size: '~4 days saved by not building it. Ship markdown.',
        refs: '§13.3, §35.1',
      },
      {
        slug: 'documents-videos',
        label: 'Documents & Videos',
        kind: 'section',
        note: 'Slide decks and handouts. §21.1.',
        children: [
          {
            slug: 'documents',
            label: 'Documents',
            kind: 'placeholder',
            whova:
              'PDF and PPTX only, 10 MB per file, ten document slots in the basic package — and documents speakers upload through the speaker form count against the same ten. More slots cost money (reviews cite ~$2,000 for unlimited).',
            needs:
              'Firebase Storage plus a `materials` subcollection, which `models.ts` already models as `SessionMaterialDoc` under `sessions/{id}/materials`. So the shape exists; the upload UI and the storage rules do not.',
            size:
              '§34: documents/slides per session, 3–4 days — and §36 D3 notes this is a free win, because there is no reason to impose a ten-file or 10 MB cap.',
            refs: '§21.1, §36 D3',
          },
        ],
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── Tickets ────
  {
    slug: 'tickets',
    label: 'Tickets',
    kind: 'section',
    note:
      'None of this is built. §0 is the reason it is shaped the way it is: Whova is four separate registration products — attendee, exhibitor, sponsor and speaker — each with its own tickets, question forms, confirmation emails, registration pages, discount codes and order tables, all feeding one shared attendee list. `models.ts` says ticketing stays external for 2027; §36 group B budgets ~40 days to replace it and §37 risk 1 is money correctness at $400k–900k.',
    children: [
      {
        slug: 'ticket-setup',
        label: 'Ticket Setup',
        kind: 'section',
        note: 'The attendee registration product. Whova numbers these steps in the UI. §5.',
        children: [
          {
            slug: 'create-tickets',
            label: '1.1 Create Tickets',
            kind: 'placeholder',
            whova:
              'Ticket types with price, quantity, sales window, early-bird price and end date, max per order, visibility, tax rate and fee handling. Prices lock permanently after the first sale — one instance of the "freeze on first write" pattern that runs through the whole product (§0).',
            needs: STRIPE,
            size: '§34: 4–6 days, straightforward once you accept that price locks after first sale.',
            refs: '§5.2, §36 B1',
          },
          {
            slug: 'question-forms',
            label: '1.2 Question Forms',
            kind: 'placeholder',
            whova:
              'A registration form builder — field types, required flags, conditional logic — that locks after the first response.',
            needs:
              'Nothing, if you take §35\'s advice: do not build a builder. A versioned schema in the repo plus a small editor for labels, help text, required flags and select options is 3–4 days; a real builder is 15–25.',
            size: '§34: fixed schema 3–4 days, builder 15–25 days. Build the first.',
            refs: '§5.5, §35, §36 B4',
          },
          {
            slug: 'ticket-add-ons',
            label: 'Ticket Add-ons',
            kind: 'placeholder',
            whova:
              'Workshops, dinners, merchandise. Options (t-shirt S/M/L) with per-option capacity, and every option automatically becomes an attendee segment.',
            needs: `${STRIPE} Plus per-holder assignment, which is the fiddly part.`,
            size: '§34: 5–7 days. On the recommended Tier 2 shortlist.',
            refs: '§5.4, §36 B2',
          },
          {
            slug: 'discount-codes',
            label: 'Discount Codes',
            kind: 'placeholder',
            whova:
              'Percentage, fixed or 100% comp codes with use limits, applicable tickets and expiry. A code with at least one use cannot be deleted.',
            needs: `${STRIPE} Bulk generation of N unique codes is what you actually want, for speaker comps.`,
            size: '§34: 3–4 days.',
            refs: '§5.6, §36 B3',
          },
          {
            slug: 'member-invite-only',
            label: 'Member & Invite-Only Ticketing',
            kind: 'placeholder',
            whova:
              'Restrict a ticket by email address, email domain, organisation type or AMS member level. §5.7 calls this one of Whova\'s genuinely strong features.',
            needs:
              'The registration product plus, for the member-level case, an AMS integration. `RegistrationDoc` already models `altEmails` for the adjacent problem of one person with several addresses.',
            size: 'Not separately estimated; folded into the ~40 days of §36 group B.',
            refs: '§5.7',
          },
          {
            slug: 'confirmation-email',
            label: 'Confirmation Email',
            kind: 'placeholder',
            whova: 'Several confirmation emails, each assignable per ticket type.',
            needs: `${ESP} The signed QR and PDF ticket ride along with it.`,
            size: '§34: confirmation email + signed QR + PDF ticket, 3–4 days.',
            refs: '§5.15, §36 B5',
          },
          {
            slug: 'registration-pages',
            label: 'Registration Pages',
            kind: 'placeholder',
            whova: 'Multiple public registration pages, optionally password protected.',
            needs:
              'A public web surface. This console is private by design — allowlist-only, Admin SDK behind it — so a registration page is a different app, not another route here.',
            size: 'Part of §36 B5, inside the ~40 days of group B.',
            refs: '§5.8, §36 B5',
          },
          {
            slug: 'registration-widgets',
            label: 'Registration Widgets',
            kind: 'placeholder',
            whova: 'Embeddable button link, text link or mini ticket form for the event website.',
            needs: 'The registration product, plus an embed story for knowledgegraph.tech.',
            size: 'Small once registration exists; meaningless before.',
            refs: '§5.8',
          },
          {
            slug: 'registration-settings',
            label: '1.7 Registration Settings',
            kind: 'placeholder',
            whova:
              'Apple/Google Pay, organizer notifications, whether the remaining-ticket count is visible, receipt of payment, and offline payments.',
            needs: STRIPE,
            size: 'Configuration on top of group B; no standalone estimate.',
            refs: '§5.9',
          },
          {
            slug: 'abandoned-registration',
            label: 'Abandoned Registration',
            kind: 'placeholder',
            whova: 'Capture email at step one, then chase people who started an order and did not finish.',
            needs: `${STRIPE} And ${ESP}`,
            size: '§34: 3–4 days, and it pays for itself at $799+ a ticket.',
            refs: '§5.16',
          },
          {
            slug: 'review-registration-setup',
            label: 'Review registration setup',
            kind: 'placeholder',
            whova:
              'Generates a PDF summary of the whole registration configuration and emails it to up to twenty recipients for sign-off.',
            needs: 'The registration product to summarise, plus PDF generation.',
            size: 'Trivial relative to what it summarises.',
            refs: '§1, §23.7',
          },
        ],
      },
      {
        slug: 'payout',
        label: 'Payout',
        kind: 'placeholder',
        whova:
          'Step 2 of registration setup: country and currency, then either Stripe Connect or Whova Payout. Stripe is the only processor.',
        needs: 'A Stripe account and Connect onboarding. Real money, so §37 risk 1 applies in full.',
        size: 'Inside the 8–12 days §34 gives checkout and order creation.',
        refs: '§5.10',
      },
      {
        slug: 'publish-tickets',
        label: 'Publish Tickets',
        kind: 'placeholder',
        whova: 'Step 3: publish or unpublish each of the registration products independently.',
        needs: 'The registration products.',
        size: 'A state field once the rest exists.',
        refs: '§5.19',
      },
      {
        slug: 'exhibitor-ticket-setup',
        label: 'Exhibitor Ticket Setup',
        kind: 'section',
        note:
          'A parallel universe with its own everything — 52 help articles. §8.9. This duplication is the structural fact §0 warns about.',
        children: [
          {
            slug: 'exhibitor-tickets',
            label: 'Exhibitor Tickets',
            kind: 'placeholder',
            whova: 'Booth packages as tiers, each bundling N booth-staff passes.',
            needs: `${STRIPE} Plus an exhibitor model, which does not exist.`,
            size: 'Inside group B; not separately estimated.',
            refs: '§8.9',
          },
          {
            slug: 'question-forms',
            label: 'Question Form(s)',
            kind: 'placeholder',
            whova: 'A separate form product for exhibitors, locking after the first response.',
            needs: 'Same fixed-schema answer as the attendee form (§35).',
            size: 'Shares the 3–4 day fixed-schema form.',
            refs: '§8.9',
          },
          {
            slug: 'ticket-add-ons',
            label: 'Ticket Add-ons',
            kind: 'placeholder',
            whova: 'Extra booth staff passes, furniture, power, lead scanners.',
            needs: STRIPE,
            size: 'Shares the 5–7 day add-on work.',
            refs: '§8.9',
          },
          {
            slug: 'discount-codes',
            label: 'Discount Codes',
            kind: 'placeholder',
            whova: 'A third independent discount-code table.',
            needs: STRIPE,
            size: 'Shares the 3–4 day code work — if you build one table rather than three.',
            refs: '§8.9',
          },
          {
            slug: 'booth-selection',
            label: 'Booth Selection',
            kind: 'placeholder',
            whova:
              'Upload a floormap, place pins per tier, and let exhibitors pick their booth during checkout with hold/release inventory. §8.10 calls this genuinely sophisticated.',
            needs: 'A floormap editor, pin coordinates, and inventory locking under concurrent checkout.',
            size:
              '§34: 10–15 days, deferred. §35.1: assign booths in a spreadsheet and publish a static numbered map — saves 10–15 days.',
            refs: '§8.10, §35.1',
          },
          {
            slug: 'pre-paid-exhibitors',
            label: 'Pre-paid Exhibitors',
            kind: 'placeholder',
            whova: 'Exhibitors who paid outside the platform still need a record and a booth.',
            needs: 'Manual order entry against the exhibitor product.',
            size: 'Small; depends on everything above.',
            refs: '§8.11',
          },
          {
            slug: 'confirmation-email',
            label: 'Confirmation Email',
            kind: 'placeholder',
            whova: 'A separate confirmation email per exhibitor tier.',
            needs: ESP,
            size: 'Shares the ESP work.',
            refs: '§8.9, §18.3',
          },
          {
            slug: 'registration-page-widget',
            label: 'Registration Page / Registration Widget',
            kind: 'placeholder',
            whova: 'A separate public page and embeddable widget for exhibitor sales.',
            needs: 'A public web surface.',
            size: 'Inside group B.',
            refs: '§8.9',
          },
          {
            slug: 'registration-settings',
            label: 'Registration Settings',
            kind: 'placeholder',
            whova:
              'Email authentication against an allowed list, a response-edit deadline, and notification routing.',
            needs: 'The exhibitor registration product.',
            size: 'Configuration.',
            refs: '§8.9',
          },
          {
            slug: 'offline-payments',
            label: 'Offline Payments',
            kind: 'placeholder',
            whova:
              'A separately purchased add-on with its own auto-void date. Cheque, cash, invoice or wire.',
            needs:
              'An invoice state machine: pending → received → issued, or voided (release inventory), or refunded (revoke). Mandatory admin notes and an audit trail.',
            size:
              '§34: 7–10 days and flagged deceptive. §37 open question 2 asks what share of KGC revenue is invoice/PO — if over 15%, this moves to the front.',
            refs: '§5.11, §36 B7',
          },
        ],
      },
      {
        slug: 'sponsor-ticket-setup',
        label: 'Sponsor Ticket Setup',
        kind: 'section',
        note:
          'The third registration product. The tiered-vs-a-la-carte decision locks permanently at publish. §9.5.',
        children: [
          {
            slug: 'sponsor-tickets',
            label: 'Sponsor Tickets',
            kind: 'placeholder',
            whova:
              'Either tiers that sponsors pick exactly one of, or a-la-carte items they buy any number of. A-la-carte gets exactly one question form and one confirmation email; tiered gets many.',
            needs: STRIPE,
            size: 'Inside group B.',
            refs: '§9.5',
          },
          {
            slug: 'question-forms',
            label: 'Question Forms',
            kind: 'placeholder',
            whova: 'Multiple forms, but only if the sponsorship model is tiered.',
            needs: 'Same fixed-schema answer (§35).',
            size: 'Shares the form work.',
            refs: '§9.5',
          },
          {
            slug: 'confirmation-emails',
            label: 'Confirmation Emails',
            kind: 'placeholder',
            whova: 'Multiple confirmation emails, again only if tiered.',
            needs: ESP,
            size: 'Shares the ESP work.',
            refs: '§9.5',
          },
          {
            slug: 'discount-codes',
            label: 'Discount Codes',
            kind: 'placeholder',
            whova: 'A fourth independent discount-code table.',
            needs: STRIPE,
            size: 'Shares the code work.',
            refs: '§9.5',
          },
          {
            slug: 'registration-page-widget',
            label: 'Registration Page / Registration Widget',
            kind: 'placeholder',
            whova: 'A public sponsor sales page, plus a mini ticket form widget.',
            needs: 'A public web surface.',
            size: 'Inside group B.',
            refs: '§9.5',
          },
          {
            slug: 'registration-settings',
            label: 'Registration Settings',
            kind: 'placeholder',
            whova: 'Registrant email authentication, a response-edit deadline, notifications.',
            needs: 'The sponsor registration product.',
            size: 'Configuration.',
            refs: '§9.5',
          },
        ],
      },
      {
        slug: 'attendee-customization',
        label: 'Attendee Customization',
        kind: 'section',
        note: 'Turning what someone bought into what they can see and do.',
        children: [
          {
            slug: 'attendee-categories',
            label: 'Attendee Categories',
            kind: 'placeholder',
            whova:
              'Public labels shown on attendee profiles — ticket types never are. Auto-createable from ticket type, or from exactly one multiple-choice question on the default form, a limitation with its own help article because people keep hitting it.',
            needs:
              'A `categories` array on the attendee record. §10.4 notes the Categories/Segments split is arbitrary and one tagging system with a `public: boolean` flag would be strictly better — worth fixing rather than copying.',
            size: '§34 folds categories into attendee model + import at 5–7 days.',
            refs: '§10.4',
          },
          {
            slug: 'ticket-tiering',
            label: 'Ticket Tiering',
            kind: 'section',
            note: 'What each ticket type unlocks.',
            children: [
              {
                slug: 'ticket-session-mapping',
                label: 'Ticket Session Mapping',
                kind: 'placeholder',
                whova:
                  'A paid add-on. Per ticket: all sessions, or specific ones expressed as a day, a track or individual sessions — or the inverse, all-except. Restrict by add-on so the workshop add-on is what gets you into the workshop. Includes a "test my mappings" tool by ticket type or by attendee email, which is an excellent debugging affordance.',
                needs:
                  '`EntitlementDoc` in `models.ts` already models exactly this (`kind: session | workshop | meal`, `source: order | comp | speaker | staff`). What is missing is the mapping UI and enforcement at check-in.',
                size: '§34: 4–6 days. On the recommended Tier 2 shortlist.',
                refs: '§10.6',
              },
              {
                slug: 'video-access',
                label: 'Video Access',
                kind: 'placeholder',
                whova: 'A paid add-on gating recorded sessions by ticket type.',
                needs:
                  'A video platform. `TicketTypeDoc.includesVideoLibrary` already exists as a field; §37 open question 8 asks whether the Vimeo OTT library is a contractual attendee benefit.',
                size: '§34: paid video library (Mux/Cloudflare Stream + entitlement) 8–12 days, post-event deadline.',
                refs: '§10.6, §37',
              },
              {
                slug: 'speed-networking-access',
                label: 'Speed Networking access',
                kind: 'placeholder',
                whova: 'Which ticket types may join speed networking.',
                needs: 'Speed networking, which §34 cuts.',
                size: 'Not applicable.',
                refs: '§20.4',
              },
              {
                slug: 'round-table-access',
                label: 'Round Table access',
                kind: 'placeholder',
                whova: 'Which ticket types may join round tables.',
                needs: 'Round tables, which §34 cuts.',
                size: 'Not applicable.',
                refs: '§20.5',
              },
            ],
          },
        ],
      },
      {
        slug: 'ticket-marketing',
        label: 'Ticket Marketing',
        kind: 'section',
        note: 'Selling the tickets. §5.18.',
        children: [
          {
            slug: 'email-campaign',
            label: 'Email Campaign',
            kind: 'placeholder',
            whova: 'Bulk email capped at 4,000 messages a month, and — oddly — it cannot be scheduled.',
            needs: ESP,
            size: '§34: campaign machinery 8–12 days; deliverability 1–2.',
            refs: '§5.18, §18.5',
          },
          {
            slug: 'campaign-contact-list',
            label: 'Campaign Contact List',
            kind: 'placeholder',
            whova: 'Build or reuse a contact list. Notably it is the one thing in the product that cannot be exported.',
            needs: 'A contacts model separate from attendees.',
            size: 'Small; part of the campaign machinery.',
            refs: '§5.18, §23.7',
          },
          {
            slug: 'campaign-link-tracking',
            label: 'Campaign Link Tracking',
            kind: 'placeholder',
            whova:
              'Per-channel tracking links showing clicks and tickets sold — real conversion attribution, and the only answer Whova has to "how did my campaign do". There is no open tracking.',
            needs: 'A redirect endpoint and an attribution join to orders.',
            size: 'A couple of days once orders exist.',
            refs: '§5.18, §23.1',
          },
          {
            slug: 'abandoned-registration',
            label: 'Abandoned Registration',
            kind: 'placeholder',
            whova: 'The same abandoned-cart feature, surfaced again under marketing.',
            needs: `${STRIPE} And ${ESP}`,
            size: '§34: 3–4 days.',
            refs: '§5.16',
          },
          {
            slug: 'referral-contest',
            label: 'Referral Contest',
            kind: 'placeholder',
            whova: 'Attendees get a referral link; whoever brings the most registrations wins.',
            needs: 'Attribution plus a contest model.',
            size: 'Not separately estimated.',
            refs: '§5.17',
          },
          {
            slug: 'social-sharing',
            label: 'Social Sharing',
            kind: 'placeholder',
            whova: 'Pre-written posts and graphics attendees can share.',
            needs: 'Nothing much — this is a Canva template and a paragraph of copy.',
            size: 'Not worth building.',
            refs: '§5.18',
          },
          {
            slug: 'event-listing',
            label: 'Event Listing',
            kind: 'placeholder',
            whova:
              'A listing in Whova\'s own marketplace, with up to twenty speakers and ten sessions highlighted.',
            needs: 'A marketplace. This is the vendor\'s distribution channel, not a feature of the software.',
            size: 'Zero, permanently. Listed for completeness.',
            refs: '§5.18',
          },
        ],
      },
      {
        slug: 'orders-transactions',
        label: 'Orders & Transactions',
        kind: 'section',
        note: 'Where the money is reconciled. §6.',
        children: [
          {
            slug: 'summary',
            label: 'Summary',
            kind: 'placeholder',
            whova: 'Registration overview across all three products, net sales, and a refund summary.',
            needs: STRIPE,
            size: '§36 B9 is six numbers and two charts once orders exist.',
            refs: '§6.1, §23.1',
          },
          {
            slug: 'attendee-orders',
            label: 'Attendee Orders',
            kind: 'placeholder',
            whova:
              'Order detail, manual add, refund, resend confirmation, export. Multi-sheet xlsx including question-form responses.',
            needs: `${STRIPE} Plus an audit trail on every order mutation — the console already has \`auditLog\` for exactly this shape.`,
            size: 'Inside the 8–12 day checkout estimate plus 4–5 days for refunds.',
            refs: '§6.1, §36 B6',
          },
          {
            slug: 'exhibitor-orders',
            label: 'Exhibitor Orders',
            kind: 'placeholder',
            whova: 'A separate order table, plus offline orders and "remove exhibitor without refund".',
            needs: 'The exhibitor product.',
            size: 'Inside group B.',
            refs: '§6.1',
          },
          {
            slug: 'sponsor-orders',
            label: 'Sponsor Orders',
            kind: 'placeholder',
            whova: 'A third order table.',
            needs: 'The sponsor product.',
            size: 'Inside group B.',
            refs: '§6.1',
          },
          {
            slug: 'transaction-history',
            label: 'Transaction History',
            kind: 'placeholder',
            whova: 'Charges and refunds as a ledger.',
            needs:
              'Stripe as the source of truth plus a reconciliation report against it — §37 risk 1\'s named mitigation.',
            size: 'Inside the refund ledger, §34 4–5 days.',
            refs: '§6.1, §37',
          },
          {
            slug: 'payout-summary',
            label: 'Payout Summary',
            kind: 'placeholder',
            whova: 'What Whova has paid out and when, with its own terminology for gross/net/fees.',
            needs: 'Stripe Connect payouts. With direct Stripe this screen is the Stripe dashboard.',
            size: 'Zero if payouts go straight to a Stripe account KGC owns.',
            refs: '§6.1, §6.2',
          },
        ],
      },
      {
        slug: 'export-ams-crm',
        label: 'Export to AMS/CRM',
        kind: 'placeholder',
        whova: 'Direct HubSpot OAuth, or anything else via Zapier, with an export history you can download.',
        needs: 'An OAuth integration and a field mapping. Or a CSV, which is what everyone actually uses.',
        size: '§34 puts public API + webhooks at 8–12 days and cuts it: "You own the DB."',
        refs: '§24.1, §34.1',
      },
    ],
  },

  // ─────────────────────────────────────────────────────────── Attendees ────
  {
    slug: 'attendees',
    label: 'Attendees',
    kind: 'section',
    note:
      'The single shared attendee list that every registration product feeds, and the substrate for the app, check-in, badges, certificates and analytics. §0.',
    children: [
      {
        slug: 'manage-attendees',
        label: 'Manage Attendees',
        kind: 'section',
        note: 'The list itself, and everything that moves data in or out of it. §10.',
        children: [
          {
            slug: 'attendees',
            label: 'Attendees',
            kind: 'implemented',
            note: 'The attendee list, searchable. §10.3.',
          },
          {
            slug: 'import-attendees',
            label: 'Import Attendees',
            kind: 'placeholder',
            whova:
              'Three modes: the Whova xlsx template, your own format with a real column mapper, or a sync from Eventbrite, Constant Contact, RegFox or Zapier every 24 hours. Errors are reported row by row, with a documented taxonomy — duplicate email, possible duplicate name, missing emails.',
            needs:
              'The generic importer. §35.3 is emphatic that this should be built once — header detection, column mapping, validation, row-level errors, upsert with a declared key, generated-ID handback — and reused for every entity: 6–9 days once and ~0.5 days per entity, against 25+ days for eight bespoke ones. `scripts/src/import-whova.ts` is the CSV half of this already.',
            size:
              '§34: attendee model + import/export, 5–7 days, flagged deceptive — the upsert rules are where it balloons. Note Whova\'s own trap: a blank Ticket Type column overwrites, every other blank merges.',
            refs: '§10.1, §10.2, §35.3, §36 C1',
          },
          {
            slug: 'export-attendees',
            label: 'Export Attendees',
            kind: 'placeholder',
            whova: 'Export the basic attendee list to xlsx.',
            needs:
              'One generic exporter, not twenty. §34 puts CSV/XLSX export across all entities at 3–4 days on that condition.',
            size: '§34: 3–4 days for every entity, once.',
            refs: '§10.3, §23.7',
          },
          {
            slug: 'attendee-limit-upgrade',
            label: 'Attendee Limit Upgrade',
            kind: 'placeholder',
            whova:
              'Buy capacity in blocks of fifty or by tier. §2.4 describes the attendee limit as a monetization lever, not a technical constraint.',
            needs:
              'Nothing. It is a billing meter on someone else\'s software. Firestore charges per read, not per attendee.',
            size: 'Zero, permanently — and one of the clearer reasons to be off the incumbent.',
            refs: '§2.4, §27',
          },
          {
            slug: 'hybrid-settings',
            label: 'Hybrid Settings',
            kind: 'placeholder',
            whova: 'Show or hide each attendee\'s remote/in-person status in the app.',
            needs: 'A `remote` flag on the attendee record and a directory projection that respects it.',
            size: 'Hours, if KGC turns out to be hybrid at all.',
            refs: '§10.3',
          },
          {
            slug: 'analytics-exports',
            label: 'Analytics & Exports',
            kind: 'placeholder',
            whova:
              'Per-attendee stats — session attendance, check-ins, survey participation — searchable by name, plus a custom report export with a 13-column schema including days checked in and sessions checked in. Available before, during and after the event.',
            needs:
              'Check-in and survey data, neither of which exists yet. The columns are all derivable once `checkInLists/{id}/checkIns` is populated — the paths are already modelled.',
            size: 'Part of §36 G1, half a week for the whole reporting page.',
            refs: '§10.7, §23.3',
          },
          {
            slug: 'cross-event-report',
            label: 'Cross-Event Report',
            kind: 'placeholder',
            whova: 'Year-over-year comparison against a previous Whova event. Requires at least one.',
            needs:
              'A second year of our own data. Every document already carries `eventId` precisely so KGC 2028 can exist alongside 2027 — `models.ts` explains why adding that field later would be prohibitive.',
            size: 'Cheap in 2028, impossible today, and already designed for.',
            refs: '§10.8, §23.6',
          },
        ],
      },
      {
        slug: 'categories',
        label: 'Categories',
        kind: 'placeholder',
        whova:
          'Manually created public labels; an attendee can hold several, and they show on the profile in the app. Used for badge templates, announcement targeting and filtering.',
        needs: 'A `categories` array on the attendee record and rendering in the app\'s People tab.',
        size: 'Folded into §34\'s 5–7 day attendee model.',
        refs: '§10.4',
      },
      {
        slug: 'segments',
        label: 'Segments',
        kind: 'placeholder',
        whova:
          'Auto-generated internal cohorts, never created by hand, derived from ticket add-ons, the default segment questions (job function, industry, org size, dietary restrictions, transportation needs) and any custom registration question. §10.4 calls this the sharpest idea in the product: registration answers become operational cohorts that flow into comms, badges and check-in counts with zero configuration.',
        needs:
          'Registration answers to derive from. Nothing else — the derivation is a pure function over the response document.',
        size:
          '§34: 4–6 days, and §36 C2 says one day for the screen. On the recommended Tier 2 shortlist. This is the one to copy.',
        refs: '§10.4, §36 C2',
      },
      {
        slug: 'session-cap',
        label: 'Session Cap',
        kind: 'placeholder',
        whova:
          'A paid add-on: per-session capacity, a waitlist, manual enrolment, an RSVP view and an export with one tab per session. It is the only waitlist in the entire product — there is no ticket-level waitlist.',
        needs:
          '`SessionDoc.capacity` already exists ("absent means uncapped; enforced in a transaction, not by rules"). What is missing is the RSVP runtime, and §35.2 is clear that concurrent capacity decrements are exactly where a spreadsheet is the wrong answer.',
        size:
          '§34: 5–7 days. §37 open question 4 asks whether KGC 2027 has hard-capped workshops — if yes this is Tier 1, not Tier 2.',
        refs: '§10.5, §35.2, §36 D2',
      },
      {
        slug: 'ticket-session-mapping',
        label: 'Ticket Session Mapping',
        kind: 'placeholder',
        whova:
          'The same paid add-on reached from Tickets → Attendee Customization → Ticket Tiering. Whova exposes it in both places.',
        needs: 'See Tickets → Attendee Customization → Ticket Tiering → Ticket Session Mapping. `EntitlementDoc` already models the result.',
        size: '§34: 4–6 days.',
        refs: '§10.6',
      },
      {
        slug: 'attendee-check-in',
        label: 'Attendee Check-in',
        kind: 'section',
        note:
          'The single most important thing that happens on the morning of day one. §14, §36 E1, and §37 risk 2.',
        children: [
          {
            slug: 'check-in',
            label: 'Check-in (Event / Day / Session)',
            kind: 'implemented',
            note:
              'Scan a badge QR or type the code, at event scope. Day and session scope are lists that do not exist yet. §14.',
          },
          {
            slug: 'self-check-in',
            label: 'Self Check-in',
            kind: 'placeholder',
            whova: 'A URL plus a printable QR poster attendees scan themselves.',
            needs: 'The check-in engine, plus a public endpoint.',
            size: 'Small once check-in exists.',
            refs: '§14',
          },
          {
            slug: 'session-self-check-in',
            label: 'Session Self Check-in',
            kind: 'placeholder',
            whova: 'A per-session QR attendees scan at the door, used for capacity and certificate eligibility.',
            needs: 'The check-in engine scoped to a session.',
            size: '§34: session-level check-in 3–4 days, reusing the engine. On the Tier 2 shortlist.',
            refs: '§14, §36 E4',
          },
          {
            slug: 'kiosk-check-in',
            label: 'Kiosk Check-In',
            kind: 'placeholder',
            whova:
              'An add-on iPad app with guided access, paired badge printer and a kiosk activity dashboard.',
            needs: 'A dedicated tablet build and printer pairing.',
            size: '§34: 12–18 days, deferred — staffed stations are fine at 1,000 people.',
            refs: '§14, §34.1',
          },
          {
            slug: 'on-demand-badge-printing',
            label: 'Print badges on-demand at check-in',
            kind: 'placeholder',
            whova:
              'A printer-station portal that prints each badge as the person checks in, with a numbered job list and reprint.',
            needs:
              '`badgePrintJobs` and `badgeTemplates` are already modelled — the template is raw ZPL with `{{field}}` placeholders sent to the printer over TCP:9100, deliberately with no visual designer.',
            size: '§34: 4–6 days, and calls it the best value-per-day on the whole list for a 1,000-person door.',
            refs: '§15, §36 E3',
          },
        ],
      },
      {
        slug: 'attendee-checkout',
        label: 'Attendee Checkout',
        kind: 'placeholder',
        whova: 'Marking people as having left. Dashboard only — deliberately not in the mobile app.',
        needs: 'The check-in engine, running in reverse.',
        size: 'Hours once check-in exists. Only matters if KGC needs occupancy counts.',
        refs: '§14',
      },
      {
        slug: 'name-badges',
        label: 'Name Badges',
        kind: 'placeholder',
        whova:
          'A drag-and-drop badge designer with up to ten templates, segment abbreviations on the badge, and a compatible-printer list.',
        needs:
          '`BadgeTemplateDoc` is modelled and its comment says the quiet part: raw ZPL with placeholders, "no visual designer is planned". §34 splits the estimate — the designer is 12–18 days and is cut; the renderer against 2–3 fixed templates is 5–7 and is Tier 1.',
        size:
          '§34: renderer 5–7 days. §37 risk 3 is badges being physically wrong — buy the printer and stock in January and print 50 real badges.',
        refs: '§15, §34.1, §36 E3',
      },
      {
        slug: 'certificates',
        label: 'Certificates',
        kind: 'placeholder',
        whova:
          'CE/CEU/attendance certificates: one to ten templates depending on package, 500–3,000 sends, merged and emailed or downloaded as one PDF.',
        needs: `Session-level attendance data to make eligibility real, plus PDF generation. ${ESP}`,
        size: '§34: 3–4 days.',
        refs: '§16',
      },
      {
        slug: 'call-for-volunteers',
        label: 'Call for Volunteers',
        kind: 'placeholder',
        whova: 'An application form, an applicant list, and emails to all applicants, the accepted, or the not-yet-notified.',
        needs: 'An application model and a shift roster.',
        size: '§35.1: use a Google Form and a spreadsheet — saves ~8 days. Do not build the module.',
        refs: '§25, §35.1',
      },
      {
        slug: 'release-and-consent-form',
        label: 'Release and Consent Form',
        kind: 'placeholder',
        whova:
          'Exactly one per event, and it locks at publish — deleting it afterwards requires emailing support.',
        needs:
          'A consent record per attendee with a timestamp and the form version. Photo and recording release for a conference that films its talks is a genuine legal need, not a nice-to-have.',
        size: 'Small: a form, a stored acceptance, a column in the export.',
        refs: '§17',
      },
      {
        slug: 'integrations',
        label: 'Integrations',
        kind: 'placeholder',
        whova: 'Mailchimp, Constant Contact, and CRMs via Zapier.',
        needs: 'OAuth and field mapping per integration.',
        size: 'Not worth it for one event a year with an export button.',
        refs: '§24.1',
      },
      {
        slug: 'admin-settings',
        label: 'Admin Settings',
        kind: 'placeholder',
        whova:
          'Up to thirty admins, check-in staff accounts, an invitation code (minimum ten characters, not case sensitive) for people signing in with an address that is not on the attendee list, and share/request templates.',
        needs:
          'Two roles is enough (§36 A2). `Role` in `models.ts` already has `organizer` and `checkin`, mirrored into a custom claim that `firestore.rules` reads. What the console has today is `CONSOLE_ALLOWLIST` — an env var, which §36 A2 and DECISIONS.md #5 both call the right size for ten people. **The real gap here is not this screen: it is that console sign-in has no SSO and no MFA**, and `src/lib/auth.ts` says in bold that must land before this is reachable over a network.',
        size: '§34: check-in staff role + volunteer access, 2–3 days. SSO/MFA is the prerequisite, not this screen.',
        refs: '§3.1, §3.2, §36 A2',
      },
    ],
  },

  // ────────────────────────────────────────────────────────── Engagement ────
  {
    slug: 'engagement',
    label: 'Engagement',
    kind: 'section',
    note:
      'What attendees actually touch. §32 argues this is the least expensive part of the incumbent bill and should be the last thing replaced — most of it is already built in the Expo app rather than here.',
    children: [
      {
        slug: 'announcements',
        label: 'Announcements',
        kind: 'implemented',
        note: 'Push, email and a Community Board thread. §18.1.',
      },
      {
        slug: 'surveys',
        label: 'Surveys',
        kind: 'placeholder',
        whova:
          'Five creation paths — scratch, template, question bank, import a Google Form, or reuse a past survey. Anonymous or name-and-email collected. Locks after the first response.',
        needs: 'A form-rendering component shared with registration, plus a response model.',
        size: '§34: surveys + session feedback + export, 6–8 days.',
        refs: '§19.1',
      },
      {
        slug: 'session-feedback',
        label: 'Session Feedback',
        kind: 'placeholder',
        whova: 'Per-session feedback forms with reminders, exported as xlsx, PDF or a summary.',
        needs: 'The same form component, scoped per session.',
        size: 'Inside the 6–8 day survey estimate.',
        refs: '§19',
      },
      {
        slug: 'live-polling',
        label: 'Live Polling',
        kind: 'placeholder',
        whova: 'Polls attached to a session, schedulable, optionally anonymous, with a live presentation link.',
        needs:
          '`PollDoc` and `PollVoteDoc` are already modelled, and the comment on `tallies` is the interesting part: an earlier design held votes in a map on the poll document, and 1,000 voters against Firestore\'s ~1 write/sec/document limit would take 16m40s to drain — under 10% landed by the time the organizer read the screen. One document per voter fixes it. **`tallies` and `totalVotes` are function-owned; the console must never write them.**',
        size: '§34: 5–7 days, "skip unless someone asks".',
        refs: '§19, DECISIONS.md D2',
      },
      {
        slug: 'gamification',
        label: 'Gamification',
        kind: 'placeholder',
        whova:
          'Four contests — leaderboard, photo, icebreaker, trivia — each independently enabled, each with prizes and reuse-from-past-event. The leaderboard locks at publish and a published trivia contest cannot be turned off early.',
        needs: 'A points model, contest state and app UI.',
        size: '§34: 12–18 days for the suite. Cut.',
        refs: '§20.2',
      },
      {
        slug: 'community',
        label: 'Community',
        kind: 'placeholder',
        whova:
          'Three objects: meet-ups (with notifications and an attending count), discussion topics (including the special "Ask organizers anything" topic whose name locks at publish), and social groups.',
        needs:
          'Partly built already — `communityPosts` exists, is seeded, and the app\'s Community tab renders posting, replies and reactions. What is missing is the *organizer* side: creating topics and meet-ups, and moderating. Note `replyCount` and `reactionCount` are function-owned and must never be written here.',
        size: 'The organizer half is a few days on top of what the app already has.',
        refs: '§20.1',
      },
      {
        slug: 'announcement-wall',
        label: 'Announcement Wall',
        kind: 'placeholder',
        whova: 'Slides for venue screens, plus an embeddable activity-stream widget.',
        needs: 'A display mode and a public embed.',
        size: '§34: 4–6 days, deferred — "Google Slides".',
        refs: '§21',
      },
      {
        slug: 'photos',
        label: 'Photos',
        kind: 'placeholder',
        whova: 'An attendee photo stream, sortable, bulk downloadable, with per-photo and bulk delete.',
        needs: 'Storage, upload from the app, and a moderation queue.',
        size: 'Not separately estimated; the moderation half matters more than the feature.',
        refs: '§21, §22.1',
      },
      {
        slug: 'floormap',
        label: 'Floormap',
        kind: 'placeholder',
        whova:
          'Upload a map image and pin agenda locations and exhibitor booth numbers onto it. Attendee-uploaded maps need organizer approval.',
        needs:
          '`RoomDoc.mapX` / `mapY` already exist as 0–1 fractions of each axis, so the pin coordinates are modelled. What is missing is the image and the editor.',
        size: '§35.1: publish a static numbered image instead of building pin placement — saves 10–15 days.',
        refs: '§21, §35.1',
      },
      {
        slug: 'meeting-scheduler',
        label: '1-1 Meeting Scheduler',
        kind: 'placeholder',
        whova:
          'Organizer-created meeting blocks with a slot duration; attendees book each other. Sellable as a sponsor or exhibitor tier privilege.',
        needs: 'A slot model and booking with concurrency control.',
        size: 'Not separately estimated in §34.',
        refs: '§20.3',
      },
      {
        slug: 'speed-networking',
        label: 'Speed Networking',
        kind: 'placeholder',
        whova: 'A paid add-on: shuffling video chats of two to four attendees, with optional gamification and a sponsor.',
        needs: 'A video platform and a matching engine.',
        size: '§34: speed networking / round tables 15–25 days. Cut.',
        refs: '§20.4',
      },
      {
        slug: 'round-table',
        label: 'Round Table',
        kind: 'placeholder',
        whova: 'A paid add-on: virtual tables with assigned hosts that attendees move between freely.',
        needs: 'The same video platform.',
        size: 'Inside the same 15–25 days. Cut.',
        refs: '§20.5',
      },
    ],
  },

  // ─────────────────────────────────────────────────────────── Marketing ────
  {
    slug: 'marketing',
    label: 'Marketing',
    kind: 'section',
    note:
      'Public-facing surfaces. KGC already has knowledgegraph.tech, so most of this is a duplicate of a website that exists.',
    children: [
      {
        slug: 'event-website',
        label: 'Event Website',
        kind: 'placeholder',
        whova: 'Twenty-plus templates, drag-reorderable sections, a countdown and a registration button.',
        needs: 'Nothing — knowledgegraph.tech exists. §34 notes the alternative is "just render into the existing KGC site".',
        size: '§34: event website + embeds 6–9 days, avoidable entirely.',
        refs: '§21, §34.1',
      },
      {
        slug: 'event-webpages',
        label: 'Event Webpages',
        kind: 'section',
        note: 'Embeddable public pages generated from the dashboard\'s own data.',
        children: [
          {
            slug: 'agenda-webpage',
            label: 'Agenda Webpage',
            kind: 'placeholder',
            whova:
              'General-purpose and special-purpose variants (by day, by track, for remote attendees), a printable PDF, sessions-to-exclude, and per-page analytics.',
            needs: 'A public read endpoint over `sessions`. The data is already there and already correct.',
            size: 'Days, not weeks — this is a rendering problem, not a data problem.',
            refs: '§21, §11.10',
          },
          {
            slug: 'speaker-webpage',
            label: 'Speaker Webpage',
            kind: 'placeholder',
            whova: 'Twenty templates, custom sections, alphabetical ordering by first or last name.',
            needs: 'A public read endpoint over `speakers`, plus headshots we do not have.',
            size: 'Days. The bottleneck is speaker photos, not templates.',
            refs: '§21',
          },
          {
            slug: 'sponsor-webpage',
            label: 'Sponsor Webpage',
            kind: 'placeholder',
            whova: 'A sponsor list in three templates plus a sponsor banner, ordered by the Sponsor Manager tier order.',
            needs: 'A public read endpoint over `sponsors`, plus logos.',
            size: 'Days.',
            refs: '§21, §9.2',
          },
          {
            slug: 'exhibitor-webpage',
            label: 'Exhibitor Webpage',
            kind: 'placeholder',
            whova: 'All-at-once or slideshow, with card style and size options.',
            needs: 'Exhibitors, which do not exist here.',
            size: 'Not applicable yet.',
            refs: '§21',
          },
          {
            slug: 'artifact-webpage',
            label: 'Artifact Webpage',
            kind: 'placeholder',
            whova: 'Five templates, customisable title/description/background/fonts, artifacts to exclude, embeddable.',
            needs: 'The Artifact Center, which §34 cuts.',
            size: 'Not applicable.',
            refs: '§13.1, §21',
          },
          {
            slug: 'logistics-venue-map-webpages',
            label: 'Logistics & Venue Map Webpages',
            kind: 'placeholder',
            whova: 'Public versions of the Logistics Center entries and the floormap.',
            needs: 'The logistics markdown and a map image.',
            size: 'Hours, once the content exists.',
            refs: '§13.3, §21',
          },
          {
            slug: 'analytics',
            label: 'Analytics',
            kind: 'placeholder',
            whova: 'Page visits, per-session and per-speaker view counts, and geographic distribution.',
            needs: 'Public pages to instrument, plus an analytics tool.',
            size: 'A script tag once the pages exist.',
            refs: '§23.1',
          },
        ],
      },
      {
        slug: 'social-media-center',
        label: 'Social Media Center',
        kind: 'section',
        note: 'Scheduling and asset generation for promotion.',
        children: [
          {
            slug: 'social-media-manager',
            label: 'Social Media Manager',
            kind: 'placeholder',
            whova: 'Attendee sharing prompts, a scheduler, and the ability to invite a team member to run it.',
            needs: 'Social platform OAuth.',
            size: '§34: social media scheduler + content library 8–12 days, deferred — "Buffer/Canva".',
            refs: '§21, §34.1',
          },
          {
            slug: 'scheduler',
            label: 'Scheduler',
            kind: 'placeholder',
            whova: 'LinkedIn, X and Facebook, multiple accounts, unlimited posts. No Instagram.',
            needs: 'Three OAuth integrations and a job runner, which means Blaze.',
            size: 'Inside the same 8–12 days. Buffer costs $6 a month.',
            refs: '§21',
          },
          {
            slug: 'content-library',
            label: 'Content Library',
            kind: 'placeholder',
            whova:
              'Auto-generated promotional graphics plus event-teaser and speaker-highlight videos, built from the event\'s own data.',
            needs: 'A template renderer over speaker and session data.',
            size: 'Inside the same 8–12 days. Cut.',
            refs: '§21',
          },
        ],
      },
      {
        slug: 'whova-listing',
        label: 'Whova Listing',
        kind: 'placeholder',
        whova:
          'A listing in the vendor\'s own marketplace, with traffic analytics and retargeting emails to people who viewed it but did not register.',
        needs:
          'A marketplace we do not have and would not want. This is the vendor\'s distribution channel sold back to the organizer. Kept in the nav because §1 has it and removing it would misrepresent the map.',
        size: 'Zero, permanently.',
        refs: '§5.18, §23.1',
      },
      {
        slug: 'organizer-co-promotion',
        label: 'Organizer Co-Promotion',
        kind: 'placeholder',
        whova: 'Ask other Whova organizers to promote your event to their past attendees.',
        needs: 'Other organizers on the same platform. Structurally impossible for a single-tenant system.',
        size: 'Zero, permanently.',
        refs: '§1, §18.3',
      },
    ],
  },

  // ─────────────────────────────────────────────────── Virtual & Hybrid ────
  {
    slug: 'virtual-hybrid',
    label: 'Virtual & Hybrid',
    kind: 'section',
    note:
      'A top-level tab in §1, but §1 does not enumerate its children — these three are the ones named elsewhere in the research (§10.6, §14, §24.1). Treat the sub-nav as reconstructed rather than transcribed.',
    children: [
      {
        slug: 'online-session-manager',
        label: 'Online Session Manager',
        kind: 'placeholder',
        whova:
          'Attach a live stream or recorded video to a session and label it in-person-only or remote-only. §10.6 notes that Ticket Session Mapping, when enabled, overrides those labels.',
        needs: 'A streaming URL field on `SessionDoc` and a player in the app. Streams need a vendor; recorded video needs storage.',
        size: '§34: paid video library 8–12 days. §37 open question 8 asks whether the Vimeo OTT library is contractual.',
        refs: '§10.6, §11.4',
      },
      {
        slug: 'zoom',
        label: 'Zoom',
        kind: 'placeholder',
        whova:
          'The deepest streaming integration in the product, with its own dashboard section and a published Zoom Marketplace app.',
        needs: 'Zoom OAuth and webhooks, which means Blaze.',
        size: 'Not estimated in §34.',
        refs: '§24.1',
      },
      {
        slug: 'attendee-activity',
        label: 'Attendee Activity',
        kind: 'placeholder',
        whova:
          'The virtual equivalent of check-in: who viewed which session and for how long. §14 is explicit that virtual attendees are not checked in — this is what stands in for it.',
        needs: 'Streaming, plus per-attendee view telemetry.',
        size: 'Depends entirely on the video decision above.',
        refs: '§14',
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────── Tools ────
  {
    slug: 'tools',
    label: 'Tools',
    kind: 'section',
    note: 'Adoption, moderation and post-event. §1, §22.',
    children: [
      {
        slug: 'app-adoption',
        label: 'App Adoption',
        kind: 'placeholder',
        whova:
          'An app adoption email, an app download button in five styles, a web app link, social posts, and downloadable graphics including a QR poster and vendor logos.',
        needs: `${ESP} The graphics are a Canva afternoon.`,
        size: 'Shares the campaign machinery; the assets themselves are hours.',
        refs: '§18.2',
      },
      {
        slug: 'app-download-email',
        label: 'App Download Email',
        kind: 'placeholder',
        whova:
          'A campaign with one genuinely good detail: "Send to newly added attendees" re-sends only to people added since the last send, so nobody gets it twice. Worth copying.',
        needs: `${ESP} Plus a record of who has already received each campaign — which is the whole trick.`,
        size: '§34: campaign machinery 8–12 days once.',
        refs: '§18.2, §18.3',
      },
      {
        slug: 'moderator-tools',
        label: 'Moderator Tools',
        kind: 'placeholder',
        whova:
          'Four panels — session chats, community board, photos, and session Q&A — where an admin can search and delete. It is also the only way to delete Q&A questions. §22.3 is blunt about what is absent across all 924 articles: no ban, no mute, no report queue, no profanity filter, no code-of-conduct gate, no moderation audit log, no pre-moderation, no incident workflow. Moderation is reactive deletion and nothing else.',
        needs:
          'The models are ready for better: `CommunityPostDoc`, `CommunityReplyDoc` and `SessionQuestionDoc` all carry a soft `status` (`visible | hidden | removed`) rather than being deleted, precisely so hiding a reply does not orphan a function-maintained counter. This console also already has an `auditLog`, so a moderation audit log — which Whova does not have — is close to free.',
        size:
          'A few days for hide/unhide over the existing status fields. A real report queue is more, and is the thing worth building that the incumbent lacks.',
        refs: '§22.1, §22.2, §22.3',
      },
      {
        slug: 'admin-control',
        label: 'Admin Control',
        kind: 'placeholder',
        whova:
          'Post-event access duration — extend attendee app access by three, six or nine months, for money — and the request form for the post-event report.',
        needs:
          'Nothing. Post-event access is a billing lever on a hosted app (§2.3 documents a surprisingly dense set of expiry rules). Our data does not expire because nobody is charging rent on it.',
        size: 'Zero, permanently.',
        refs: '§2.3, §22.4',
      },
      {
        slug: 'event-report',
        label: 'Event Report',
        kind: 'placeholder',
        whova:
          'A 50–70 page branded PDF covering downloads, networking, agenda favourability, sponsor impressions, attendee breakdown and photos. It is not self-serve: you complete a survey, your account manager is notified, and delivery takes 10–14 days. Sponsor impression counts are explicitly a sales asset for next year.',
        needs: 'The underlying analytics, then a PDF generator. The sponsor-impression number is the part that has commercial value.',
        size: '§34: post-event report generator 5–7 days, Tier 2.',
        refs: '§23.4, §23.5',
      },
      {
        slug: 'war-room',
        label: 'War room',
        kind: 'implemented',
        ours: true,
        note: 'Ours, not Whova\'s. Live counts, the audit trail and the error ring.',
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── Publish ────
  {
    slug: 'publish',
    label: 'Publish',
    kind: 'placeholder',
    whova:
      'Also called "Pay & Publish". Publishing is the hinge the whole product turns on: announcements only become available after it, event dates stop being editable, the leaderboard contest locks, the release-and-consent form locks, and the sponsorship model locks. §0 calls this "freeze on first write" and names it a top source of organizer frustration.',
    needs:
      'A lifecycle state on the event. We have `PublishStatus` per session (`draft | published | cancelled`) but nothing at event level, and — importantly — no reason to copy the freezing. Almost every lock in Whova exists because state is shared with a payment record or a printed artefact, and the ones that are not are just conservatism.',
    size: 'Small as a field. The design question — which of those locks to keep — is the real work, and the honest answer is very few.',
    refs: '§0, §2.2, §2.3',
  },

  // ───────────────────────────────────────────────────────────── Preview ────
  {
    slug: 'preview',
    label: 'Preview',
    kind: 'placeholder',
    whova:
      'Preview the attendee experience as web app or mobile app before publishing, without a real attendee account.',
    needs:
      'A read-only impersonation mode. There is no web app to preview (AGENTS.md: the Next.js version was replaced by Expo in July 2026), so the honest version here is a deep link into the real Expo app running against the emulator with a seeded demo account — which is what `npm run seed` and `EXPO_PUBLIC_USE_EMULATOR=1` already give you from `app/`.',
    size:
      'Nearly zero, because the mechanism already exists; it is a link and an instruction, not a feature.',
    refs: '§1',
  },
];

// ─────────────────────────────────────────────────────────────── helpers ────

export interface NavMatch {
  node: NavNode;
  /** Root-first chain of nodes ending in `node`. */
  trail: NavNode[];
  /** The top-level tab this path belongs to. */
  top: NavNode;
}

/** Resolve URL segments against the tree. Returns null for anything not in §1. */
export function findNav(segments: string[]): NavMatch | null {
  if (segments.length === 0) return null;

  const trail: NavNode[] = [];
  let level = NAV;
  let node: NavNode | undefined;

  for (const segment of segments) {
    node = level.find((n) => n.slug === segment);
    if (!node) return null;
    trail.push(node);
    level = node.children ?? [];
  }

  return { node: node!, trail, top: trail[0] };
}

/** `['content','basics']` → `/content/basics`. */
export function hrefOf(trail: NavNode[]): string {
  return `/${trail.map((n) => n.slug).join('/')}`;
}

/**
 * Every implemented node, as `[href, node]`. Used by the section index and the
 * placeholder page to point at what does work, so a dead end is never a dead end.
 */
export function implementedNodes(): { href: string; node: NavNode }[] {
  const out: { href: string; node: NavNode }[] = [];
  const walk = (nodes: NavNode[], trail: NavNode[]) => {
    for (const n of nodes) {
      const next = [...trail, n];
      if (n.kind === 'implemented') out.push({ href: hrefOf(next), node: n });
      if (n.children) walk(n.children, next);
    }
  };
  walk(NAV, []);
  return out;
}

/**
 * The nav tree with the prose stripped out.
 *
 * The shell's nav has to be a client component, because only `usePathname()`
 * knows which entry is current. Shipping `NAV` itself would push ~40 KB of
 * placeholder essays into every browser payload to render a list of links, so
 * the client gets the four fields it actually draws with and the prose stays on
 * the server where the pages that show it already are.
 */
export interface SlimNode {
  slug: string;
  label: string;
  kind: NavKind;
  ours?: boolean;
  children?: SlimNode[];
}

export function slimNav(nodes: NavNode[] = NAV): SlimNode[] {
  return nodes.map((n) => ({
    slug: n.slug,
    label: n.label,
    kind: n.kind,
    ...(n.ours ? { ours: true } : {}),
    ...(n.children ? { children: slimNav(n.children) } : {}),
  }));
}

/** Counts for the "how much of this is real" line in the shell. */
export function navCounts(): { implemented: number; placeholder: number; section: number } {
  let implemented = 0;
  let placeholder = 0;
  let section = 0;
  const walk = (nodes: NavNode[]) => {
    for (const n of nodes) {
      if (n.kind === 'implemented') implemented += 1;
      else if (n.kind === 'placeholder') placeholder += 1;
      else section += 1;
      if (n.children) walk(n.children);
    }
  };
  walk(NAV);
  return { implemented, placeholder, section };
}
