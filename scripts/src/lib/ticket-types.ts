import type { TicketTypeDoc } from "@kgc/shared";

/**
 * The tiers KGC sells, as seed data — four for attendees, three exhibitor
 * packages and four sponsorship levels.
 *
 * ── Why this moved here ──────────────────────────────────────────────────────
 *
 * This catalogue used to live in `apps/web/src/lib/tickets.ts` as a frozen
 * array, with a comment arguing that a public price list which renders from a
 * database is a price list that shows "$0" when the database is unreachable.
 * That argument was sound while nothing could edit the prices. It stopped being
 * sound the moment the organizer dashboard grew a Create Tickets screen: two
 * places that both believe they own the price will eventually disagree, and the
 * failure mode of *that* is charging the wrong amount — considerably worse than
 * an outage, because it is silent and it is legally interesting.
 *
 * So `ticketTypes` in Firestore is now the single source of truth, and this
 * file is a **seed, not a fallback**. Nothing reads it at request time. If the
 * collection is empty the website says so loudly rather than quietly reverting
 * to prices that may be a year stale.
 *
 * ── The id is the slug ──────────────────────────────────────────────────────
 *
 * Each document id is its `id` field below, verbatim. That makes re-seeding
 * idempotent (the same four documents are rewritten, never duplicated) and
 * keeps `/tickets?tier=all-access` and the Stripe metadata readable.
 *
 * ── What re-seeding preserves ───────────────────────────────────────────────
 *
 * `quantitySold` is deliberately absent from every entry. The seeder must never
 * reset it — it is a running total of real purchases, and zeroing it on a
 * routine re-seed would make a sold-out tier look open. See `seed-ticket-types.ts`.
 */

/** Everything except the fields the seeder derives or must preserve. */
export type TicketTypeSeed = Omit<
  TicketTypeDoc,
  "eventId" | "createdAt" | "updatedAt" | "quantitySold"
> & { id: string };

/** Stripe's "General – Services" code, which their ticketing guide specifies
 *  for admission. An event ticket is taxed where the event happens, not where
 *  the buyer lives — that part is configured in the Stripe dashboard, not here. */
export const TICKET_TAX_CODE = "txcd_20030000";

export const TICKET_TYPE_SEED: readonly TicketTypeSeed[] = [
  {
    id: "all-access",
    name: "All Access (VIP)",
    priceCents: 119_900,
    currency: "usd",
    tagline: "The whole week, in the room and on demand.",
    featured: true,
    inPerson: true,
    visible: true,
    sortOrder: 10,
    audience: "attendee",
    includesVideoLibrary: true,
    includesWorkshops: true,
    taxCode: TICKET_TAX_CODE,
    includes: [
      "Every in-person session, Monday to Friday",
      "Both workshop days, Monday and Tuesday",
      "VIP community happy hour with the programme committee",
      "All evening networking events, including the Friday watch party",
      "Live streams and recordings of every virtual session",
      "Three months of the KGC Video Library",
    ],
    groups: [
      {
        heading: "All In-person Sessions",
        items: [
          "Both workshop days, Monday and Tuesday",
          "Every conference session, Wednesday to Friday",
          "VIP community happy hour with the programme committee",
          "All evening networking events",
          "The Friday watch party",
        ],
      },
      {
        heading: "All Virtual Sessions",
        items: ["Live streams of every session", "Recordings of every session"],
      },
      { heading: "KGC Video Library Subscription (3 months)" },
    ],
  },
  {
    id: "main-conference",
    name: "Main Conference",
    priceCents: 79_900,
    currency: "usd",
    tagline: "Wednesday to Friday at Cornell Tech.",
    inPerson: true,
    visible: true,
    sortOrder: 20,
    audience: "attendee",
    includesVideoLibrary: true,
    includesWorkshops: false,
    taxCode: TICKET_TAX_CODE,
    includes: [
      "Every main conference session, Wednesday to Friday",
      "Community happy hour",
      "All evening networking events, including the Friday watch party",
      "Virtual conference sessions on demand",
      "Three months of the KGC Video Library",
    ],
    groups: [
      {
        heading: "All Conference Sessions, and more",
        items: [
          "Every conference session, in person",
          "Exclusive community happy hour",
          "All evening networking events",
          "The Friday watch party",
        ],
      },
      {
        heading: "Virtual sessions",
        items: ["Every conference session, streamed on demand"],
      },
      { heading: "KGC Video Library Subscription (3 months)" },
    ],
  },
  {
    id: "workshops",
    name: "Workshops",
    priceCents: 69_900,
    currency: "usd",
    tagline: "Two days of hands-on practice.",
    inPerson: true,
    visible: true,
    sortOrder: 30,
    audience: "attendee",
    includesVideoLibrary: false,
    includesWorkshops: true,
    taxCode: TICKET_TAX_CODE,
    includes: [
      "Every in-person workshop, Monday and Tuesday",
      "Instructor-led labs at beginner, intermediate and advanced level",
      "Workshop materials and datasets to take home",
      "Community happy hour",
    ],
  },
  {
    id: "virtual",
    name: "Virtual",
    priceCents: 34_900,
    currency: "usd",
    tagline: "Every session, from wherever you are.",
    inPerson: false,
    visible: true,
    sortOrder: 40,
    audience: "attendee",
    includesVideoLibrary: false,
    includesWorkshops: false,
    taxCode: TICKET_TAX_CODE,
    includes: [
      "Live streams of every conference and workshop session",
      "Watch Monday through Friday in your own time zone",
      "On-demand replays for at least a month afterwards",
      "The virtual hallway track, and session Q&A in the KGC app",
    ],
  },

  /**
   * ── Exhibitor packages ────────────────────────────────────────────────────
   *
   * Priced per booth size, which is how every trade floor prices, and capped by
   * `quantityTotal` because floor space is the one thing at a conference that
   * genuinely runs out. The cap is a **sold counter, not a reservation** (see
   * `TicketTypeDoc.quantitySold`) — two exhibitors can pass the check and both
   * pay for the last booth. At three to twenty booths the right answer to that
   * is a refund and an apology, not a distributed lock.
   *
   * `visible: true` puts them on `/tickets/exhibitor`, which is a different
   * page from `/tickets` — `listTiers` takes the audience as a parameter, so
   * these never appear in the attendee catalogue.
   */
  {
    id: "exhibitor-startup-table",
    name: "Startup Table",
    priceCents: 149_900,
    currency: "usd",
    tagline: "A high table in the hall, for companies under three years old.",
    inPerson: true,
    visible: true,
    sortOrder: 10,
    audience: "exhibitor",
    includesVideoLibrary: false,
    includesWorkshops: false,
    quantityTotal: 12,
    taxCode: TICKET_TAX_CODE,
    includes: [
      "One poseur table in the exhibition hall, Wednesday to Friday",
      "One Main Conference pass for booth staff",
      "Exhibitor listing in the KGC app with your materials",
      "Lead capture by badge scan, with no per-lead fee",
    ],
  },
  {
    id: "exhibitor-standard-booth",
    name: "Standard Booth",
    priceCents: 349_900,
    currency: "usd",
    tagline: "A 3m × 2m booth on the main aisle.",
    inPerson: true,
    visible: true,
    sortOrder: 20,
    audience: "exhibitor",
    includesVideoLibrary: false,
    includesWorkshops: false,
    quantityTotal: 16,
    taxCode: TICKET_TAX_CODE,
    includes: [
      "3m × 2m booth space with power and a wired network drop",
      "Two Main Conference passes for booth staff",
      "Exhibitor listing in the KGC app with your materials",
      "Lead capture by badge scan, with no per-lead fee",
      "Your logo on the exhibition-hall floor plan",
    ],
  },
  {
    id: "exhibitor-premium-booth",
    name: "Premium Booth",
    priceCents: 649_900,
    currency: "usd",
    tagline: "A 6m × 2m corner booth beside the coffee.",
    featured: true,
    inPerson: true,
    visible: true,
    sortOrder: 30,
    audience: "exhibitor",
    includesVideoLibrary: false,
    includesWorkshops: false,
    quantityTotal: 6,
    taxCode: TICKET_TAX_CODE,
    includes: [
      "6m × 2m corner booth in the catering aisle, with power and network",
      "Four All Access passes for booth staff",
      "Featured exhibitor listing, pinned above the rest in the app",
      "Lead capture by badge scan, with no per-lead fee",
      "A ten-minute demo slot on the exhibition-hall stage",
    ],
  },

  /**
   * ── Sponsorship levels ────────────────────────────────────────────────────
   *
   * The four ids match `SponsorTier` exactly (`platinum | gold | silver |
   * bronze`), because `SponsorDoc.tier` is that union and a sponsorship
   * purchase has to be able to set it without a mapping table in between. A
   * fifth level here would need the union widened first, which is the correct
   * order — the model should refuse a tier the app cannot render.
   *
   * Platinum is capped at one. That is the product: exclusivity is the thing
   * being sold, and a second platinum sponsor devalues the first one's
   * purchase retroactively.
   */
  {
    id: "sponsor-bronze",
    name: "Bronze",
    priceCents: 500_000,
    currency: "usd",
    tagline: "Your name in the app and on the sponsor wall.",
    inPerson: true,
    visible: true,
    sortOrder: 40,
    audience: "sponsor",
    includesVideoLibrary: false,
    includesWorkshops: false,
    taxCode: TICKET_TAX_CODE,
    includes: [
      "Sponsor listing in the KGC app for the whole week",
      "Your logo on the sponsor wall and the website",
      "Two Main Conference passes",
      "Post-event attendee demographics",
    ],
  },
  {
    id: "sponsor-silver",
    name: "Silver",
    priceCents: 1_200_000,
    currency: "usd",
    tagline: "Bronze, plus a presence attendees walk past all week.",
    inPerson: true,
    visible: true,
    sortOrder: 50,
    audience: "sponsor",
    includesVideoLibrary: false,
    includesWorkshops: false,
    taxCode: TICKET_TAX_CODE,
    includes: [
      "Everything in Bronze",
      "A banner in the KGC app's sponsor rotation",
      "Your logo on session-room signage",
      "Four All Access passes",
      "Opt-in contact details from attendees who save your listing",
    ],
  },
  {
    id: "sponsor-gold",
    name: "Gold",
    priceCents: 2_500_000,
    currency: "usd",
    tagline: "A session on the programme, not a banner beside it.",
    inPerson: true,
    visible: true,
    sortOrder: 60,
    audience: "sponsor",
    includesVideoLibrary: true,
    includesWorkshops: true,
    taxCode: TICKET_TAX_CODE,
    includes: [
      "Everything in Silver",
      "A 30-minute sponsored session, listed in the agenda like any other",
      "Your logo on the main-stage backdrop",
      "Eight All Access passes",
      "A standard booth in the exhibition hall",
    ],
  },
  {
    id: "sponsor-platinum",
    name: "Platinum",
    priceCents: 5_000_000,
    currency: "usd",
    tagline: "One per year. Named on the conference itself.",
    featured: true,
    inPerson: true,
    visible: true,
    sortOrder: 70,
    audience: "sponsor",
    includesVideoLibrary: true,
    includesWorkshops: true,
    quantityTotal: 1,
    taxCode: TICKET_TAX_CODE,
    includes: [
      "Everything in Gold",
      "Named presenting sponsor on every conference surface",
      "A keynote-adjacent 45-minute session",
      "The lanyards every attendee wears for five days",
      "Sixteen All Access passes",
      "A premium booth in the exhibition hall",
    ],
  },
] as const;
