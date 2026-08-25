import type { TicketTypeDoc } from "@kgc/shared";

/**
 * The four tiers KGC actually sells, as seed data.
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
] as const;
