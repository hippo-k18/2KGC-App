/**
 * The `settings/{key}` contract — key names, value shapes, defaults, and the
 * register of which install actually reads each field.
 *
 * ── Why this is in `@kgc/shared` and not in the dashboard ───────────────────
 *
 * `settings` is the one collection that is *written* by exactly one install and
 * *meant to be read* by three: the organizer dashboard authors it, the public
 * website renders some of it, and the attendee app renders the rest. Those
 * three are separate npm installs that cannot import each other — the same
 * constraint that put `COLLECTIONS` and `EVENT_ID` here. A key name spelled in
 * two places is a setting that saves in one install and is invisible in the
 * next, and nobody finds out, because the write still succeeds.
 *
 * `models.ts` argues that a union of twelve settings shapes would be "edited on
 * every screen and therefore always slightly wrong". That argument held while
 * `values` was a private bag the authoring screen also read back. It stops
 * holding the moment a second install has to know what is in the bag: then the
 * shape *is* the interface, and the place an interface must not be duplicated
 * is exactly here. There are three keys, not twelve — see below for why.
 *
 * ── The register is the point ───────────────────────────────────────────────
 *
 * Every field carries a `SettingsFieldStatus`. That is not documentation: the
 * Branding Center and the access screens render it, so a control cannot claim
 * an effect the register does not grant it. When a surface starts reading a
 * field, its agent flips one entry here and every screen that mentions the
 * field updates with it. That is the whole reason the handoffs in
 * `docs/audit-2026-08-30/FOLLOW-UPS.md` are one-line changes rather than
 * a hunt through JSX.
 *
 * ── Three keys, not six ─────────────────────────────────────────────────────
 *
 * `event-website`, `registration` and `app-adoption` used to be declared here
 * (as `SETTINGS_KEYS` in the dashboard) and were never written *or* read by
 * anything, in any install, ever. They are gone. A reserved key is a promise
 * that a screen is coming, and all three promises were already answered
 * elsewhere: website content is `webpages.ts`, registration rules are
 * `questionForms` + `ticketTypes`, and app adoption is a *metric* — a thing you
 * measure, not a thing you set, so no value could ever have been stored under
 * it. Add a key back when a screen writes it in the same commit.
 */

import { EVENT_SETTINGS_DEFAULTS, type EventSettings } from "./event-basics.js";
import {
  DEFAULT_ATTENDEE_CATEGORIES,
  type AttendeeCategoryDef,
  type TicketCategoryRule,
} from "./attendee-categories.js";
import { DEFAULT_SPONSOR_TIERS, type SponsorTierDef } from "./sponsor-tiers.js";

/** Every settings key in use. A const so a typo is a compile error. */
export const SETTINGS_KEYS = {
  branding: "branding",
  access: "access",
  logistics: "logistics",
  /** Content > Basics. Public: the website and the app both print it. */
  event: "event",
  /** Content > Sponsor Center > Sponsor Tiering. Public for the same reason. */
  sponsorTiers: "sponsorTiers",
  /** Attendees > Categories, and the ticket rule under Tickets. Not public. */
  attendeeCategories: "attendeeCategories",
} as const;

/**
 * The bags a signed-out phone may read. `firestore.rules` names the same
 * three keys; everything in them is already printed on the public website.
 */
export const PUBLIC_SETTINGS_KEYS: readonly SettingsKey[] = ["branding", "event", "sponsorTiers"];

export type SettingsKey = (typeof SETTINGS_KEYS)[keyof typeof SETTINGS_KEYS];

/**
 * `settings/branding` — how the event presents itself.
 *
 * ⚠️ The two colours are the fields most likely to be misread as live theming.
 * See `SETTINGS_REGISTER.branding` for what each one actually reaches.
 */
export interface BrandingSettings {
  /** Six-digit hex, upper case, including the leading `#`. */
  brandColor: string;
  /** Six-digit hex, upper case, including the leading `#`. */
  accentColor: string;
  /** One line, under 80 characters. Marketing copy, not the event name. */
  tagline: string;
  /** Lower case. Where an attendee writes when something is wrong. */
  supportEmail: string;
  /** Stored without the leading `#`, so a renderer decides how to print it. */
  hashtag: string;
  /** A URL path segment: 3–40 lower-case letters, digits and hyphens. */
  brandedSlug: string;
  /** An image URL, uploaded here or pasted. Shown in the website and app headers. */
  logoUrl: string;
  /** An image URL. The wide picture behind the website hero and the app's Home header. */
  bannerUrl: string;
}

/** `settings/sponsorTiers` — the ordered tier list. See `sponsor-tiers.ts`. */
export interface SponsorTierSettings {
  tiers: SponsorTierDef[];
}

/**
 * `settings/access` — who gets in, what they can see, and for how long.
 *
 * ⚠️ Nothing here is a security control and nothing here may become one by
 * being read. `firestore.rules` gates on the `registered` custom claim; a
 * client that reads `attendeeListVisible` and hides a tab is drawing a curtain,
 * not locking a door. Any field in here that is ever enforced must be enforced
 * in the rules, and the register entry says so per field.
 */
export interface AccessSettings {
  attendeeListVisible: boolean;
  contactSharingEnabled: boolean;
  /** Event-wide. Off hides messaging in the app and refuses the writes. */
  attendeeMessagingEnabled: boolean;
  /** Shown to whoever is running the check-in desk. Under 300 characters. */
  staffNote: string;
  /** 4–32 letters, digits or hyphens, upper case. Read out loud, so no punctuation. */
  eventCode: string;
  codeRequired: boolean;
  /** Whole days after the event ends. `0` means access ends with the event. */
  postEventDays: number;
  postEventReadOnly: boolean;
}

/**
 * `settings/logistics` — the emergency card.
 *
 * Free text throughout, deliberately: these fields get filled in with
 * "Campus security, ext. 4400" and "Tim — WhatsApp only", and a phone-number
 * regex makes the field unusable at the moment somebody needs it most. The
 * reasoning is recorded at the write site in the dashboard's
 * `logistics-management/actions.ts`.
 */
export interface LogisticsSettings {
  emergencyNumber: string;
  venueSecurity: string;
  medicalPoint: string;
  assemblyPoint: string;
  onSiteLead: string;
  onSiteLeadPhone: string;
  incidentProcedure: string;
  /** The organizer's own assertion that the card is worth showing anyone. */
  planReady: boolean;
}

/**
 * `settings/attendeeCategories` — the category list and the ticket rules. See
 * `attendee-categories.ts`. Not readable by a phone: the app prints the name
 * already copied onto the holder's own registration.
 */
export interface AttendeeCategorySettings {
  categories: AttendeeCategoryDef[];
  ticketRules: TicketCategoryRule[];
}

/** Key → value shape. The map every install indexes to get a typed bag. */
export interface SettingsValues {
  branding: BrandingSettings;
  access: AccessSettings;
  logistics: LogisticsSettings;
  event: EventSettings;
  sponsorTiers: SponsorTierSettings;
  attendeeCategories: AttendeeCategorySettings;
}

/**
 * What a reader sees before an organizer has saved anything.
 *
 * One table rather than a default per call site: two screens reading the same
 * document with different defaults is two screens disagreeing about an unset
 * value, which is how `branded-event-url` and `app-branding` came to hold
 * different views of `settings/branding`.
 *
 * Every default is the *safe* answer, not the pretty one: the attendee list is
 * visible and contact sharing is on because that is what the app does today,
 * and a default that misdescribes live behaviour is worse than no default.
 */
export const SETTINGS_DEFAULTS: SettingsValues = {
  branding: {
    brandColor: "",
    accentColor: "",
    tagline: "",
    supportEmail: "",
    hashtag: "",
    brandedSlug: "",
    logoUrl: "",
    bannerUrl: "",
  },
  access: {
    attendeeListVisible: true,
    contactSharingEnabled: true,
    attendeeMessagingEnabled: true,
    staffNote: "",
    eventCode: "",
    codeRequired: false,
    postEventDays: 30,
    postEventReadOnly: false,
  },
  logistics: {
    /**
     * The venue is Cornell Tech, Roosevelt Island, New York. `911` is the
     * correct answer there and a blank field is not: an emergency card whose
     * first line is empty is a card nobody trusts. It is still editable — the
     * day this event is held anywhere else, it is wrong.
     */
    emergencyNumber: "911",
    venueSecurity: "",
    medicalPoint: "",
    assemblyPoint: "",
    onSiteLead: "",
    onSiteLeadPhone: "",
    incidentProcedure: "",
    planReady: false,
  },
  event: EVENT_SETTINGS_DEFAULTS,
  sponsorTiers: { tiers: DEFAULT_SPONSOR_TIERS },
  attendeeCategories: { categories: DEFAULT_ATTENDEE_CATEGORIES, ticketRules: [] },
};

/** The installs that can read a settings document. */
export type SettingsSurface = "organizer" | "web" | "app";

/**
 * What a field currently reaches.
 *
 * `pending` is the honest middle state and the reason this enum has three
 * members instead of two: the field is worth writing now, a named surface will
 * read it, and until that lands the screen must say "waiting on" rather than
 * "saved". Deleting the middle state forces every unbuilt reader to be
 * described as either working or pointless, and both are lies.
 */
export type SettingsFieldStatus =
  /** A surface listed in `readers` reads this field today. */
  | "live"
  /** No surface reads it yet; `handoff` names the follow-up that will. */
  | "pending"
  /** Nothing can consume it, and that is a decision. `why` gives the reason. */
  | "recorded";

export interface SettingsFieldFacts {
  status: SettingsFieldStatus;
  /** Which installs read the field. Empty unless `status` is `live`. */
  readers: readonly SettingsSurface[];
  /** For `pending`: the FOLLOW-UPS.md item that makes it live. */
  handoff?: string;
  /** For `recorded` and `pending`: one sentence a non-author can act on. */
  why: string;
}

type Register = { [K in SettingsKey]: { [F in keyof SettingsValues[K]]: SettingsFieldFacts } };

/**
 * ★ Which surface reads which field — the register the screens render.
 *
 * Kept beside the shapes rather than in a doc because a doc cannot be wrong in
 * a way `tsc` notices: adding a field to `BrandingSettings` without deciding
 * who reads it fails to compile here, which is the only mechanism that has ever
 * stopped this repo shipping a control with no consumer.
 *
 * ⚠️ Flipping an entry to `live` is a claim about code that exists. Verify the
 * reader before you change it — including against `firestore.rules`, which is
 * where an app-side read of this collection used to die: the collection had no
 * `match` block at all, so the client SDK was denied by the default-closed
 * posture and a `pending` app read was blocked on a rules change plus a deploy,
 * not just on a hook.
 *
 * ⚠️ That block now exists and it names the keys one at a time. Adding an app
 * reader for `branding` or `access` is therefore still a rules change — and for
 * `access` it is a change that must not be made, because `staffNote` is in it
 * and rules filter documents, not fields. The four access fields marked `live`
 * below reach the phone through `settings/appAccess`, a derived projection
 * carrying only those four; `app-access.ts` has the argument.
 */
export const SETTINGS_REGISTER: Register = {
  branding: {
    brandColor: {
      status: "live",
      readers: ["web", "app"],
      why:
        "The website's root layout turns it into the navy custom properties (header, " +
        "primary button) and the app's useTheme() lays it over header, tint and accent. " +
        "Both derive their text and hover steps with brandPalette() in brand-theme.ts, " +
        "and both keep their built-in palette until a colour is saved.",
    },
    accentColor: {
      status: "live",
      readers: ["web"],
      why:
        "The website's highlight colour (links, the teal accents). The app has one brand " +
        "colour and no second accent to map it to.",
    },
    tagline: {
      status: "live",
      readers: ["web", "app"],
      why:
        "The app's sign-in screen prints it under the event name. The website's OG description. apps/web/src/app/layout.tsx became " +
        "generateMetadata() to read it, and keeps SITE.tagline as the fallback so an " +
        "empty setting cannot blank a social card. Baked at build on prerendered " +
        "routes and regenerated per request on the force-dynamic ones.",
    },
    supportEmail: {
      status: "live",
      readers: ["web", "app"],
      /*
       * Wired in exactly one place, and the narrowness is the decision rather
       * than an unfinished job. `SITE.contactEmail` has thirteen call sites and
       * several are client components, which cannot read Firestore at all — so
       * repointing the constant would have moved a server read into the browser
       * bundle. The root layout resolves the address once and passes it to the
       * footer, which is the only site-wide renderer of it.
       */
      why:
        "The app's sign-in screen and Me tab print it as the help address. " +
        "The site footer's contact address (apps/web/src/components/site-footer.tsx), " +
        "resolved in the root layout and passed in. The other twelve SITE.contactEmail " +
        "call sites stay on the constant — some are client components.",
    },
    hashtag: {
      status: "pending",
      readers: [],
      handoff: "FU-19",
      why: "Nothing prints an event hashtag yet on either surface.",
    },
    brandedSlug: {
      status: "live",
      readers: ["web"],
      why:
        "apps/web/src/app/[slug]/page.tsx matches the slug exactly and 307-redirects to " +
        "the homepage; anything else 404s, so the catch-all cannot swallow a top-level " +
        "route added later. A temporary redirect on purpose — a 308 on a value an " +
        "organizer can edit cannot be withdrawn from a browser cache.",
    },
    logoUrl: {
      status: "live",
      readers: ["web", "app"],
      why: "The website header and the app's sign-in screen show it in place of the built-in mark.",
    },
    bannerUrl: {
      status: "live",
      readers: ["web", "app"],
      why: "The website's homepage hero and the app's Home header use it as their picture.",
    },
  },
  access: {
    attendeeListVisible: {
      status: "recorded",
      readers: [],
      why:
        "Hiding the People tab on a client is a curtain, not a lock — the data stays " +
        "readable to anyone with the ticket claim. Directory visibility is already the " +
        "attendee's own choice (UserDoc.visibleInDirectory); an organizer override that " +
        "beat it would be a policy decision, and enforcing it means firestore.rules.",
    },
    contactSharingEnabled: {
      status: "recorded",
      readers: [],
      why: "Same as attendeeListVisible — enforceable only in firestore.rules.",
    },
    attendeeMessagingEnabled: {
      status: "live",
      readers: ["app"],
      /*
       * The one switch in this bag that is enforceable without deciding a
       * policy question first, which is why it is `live` while the two above
       * it are not. Messaging is one collection with one write path, so
       * "nobody may start a conversation" is a rule about `threads` and
       * `threads/{id}/messages` and nothing else. Hiding the attendee list,
       * by contrast, would have to overrule each attendee's own
       * `visibleInDirectory`, and that is a decision rather than a rule.
       */
      why:
        "Off hides Messages everywhere in the app and firestore.rules refuses a new " +
        "thread or message, so the switch is a lock and not a curtain. Conversations " +
        "already held stay readable.",
    },
    staffNote: {
      status: "live",
      readers: ["organizer"],
      /*
       * The one field in this bag whose intended reader is a colleague rather
       * than a client, which is why it can be `live` while everything around it
       * cannot: the check-in desk screen renders it, so the note reaches the
       * person it is addressed to.
       */
      why: "Attendees › Check-in renders it above the desk, which is who it is written for.",
    },
    eventCode: {
      status: "live",
      readers: ["app"],
      /*
       * ⚠️ `live` here means "the app asks for it", NOT "it keeps anyone out".
       * The real gate is still the `registered` claim, minted only for ticket
       * holders and checked on every request; one string a thousand people know
       * is weaker than what already runs, so firestore.rules does not look at
       * this field and must not be made to. The prompt is a front door on a
       * building whose locks are elsewhere, and it is worth having for the
       * reason a front door is: it is what an organizer reads out from a stage.
       */
      why:
        "The app asks for the code once, at first sign-in, when one is set. It is a " +
        "prompt rather than a lock: the ticket claim is the gate, and the rules do not " +
        "read this field.",
    },
    codeRequired: {
      status: "live",
      readers: ["app"],
      why: "Whether the app asks. Untick it and nobody is prompted again.",
    },
    postEventDays: {
      status: "live",
      readers: ["app"],
      why:
        "The last day of the event plus this many days is when the app stops opening. " +
        "The app shows one plain screen and firestore.rules refuses every read, so the " +
        "data closes rather than the screens hiding.",
    },
    postEventReadOnly: {
      status: "live",
      readers: ["app"],
      why:
        "From the end of the event the app still opens and takes no new posts, replies, " +
        "messages or questions. Refused in firestore.rules as well as hidden in the app.",
    },
  },
  logistics: {
    /*
     * ★ The one bag that reaches a phone. `firestore.rules` now carries
     * `match /settings/{key} { allow read: if isRegistered() && key ==
     * 'logistics'; }` — the key is named rather than the collection opened,
     * because `settings/access` beside it holds `eventCode` and `staffNote`
     * and rules filter documents, not fields. The reader is
     * `app/src/lib/data/logistics.ts`; the screen is
     * `app/src/app/(tabs)/home/logistics.tsx`, gated on `planReady`.
     *
     * ⚠️ Every entry below is `live` on the strength of a rule that is in the
     * working tree and NOT YET DEPLOYED. The emulator does not enforce the
     * absence of a rule, so a green local run says the rule is correct and says
     * nothing about production. Deploying it is `node scripts/ops/deploy-rules.mjs`.
     */
    emergencyNumber: {
      status: "live",
      readers: ["organizer", "app"],
      why: "The emergency card on Home reads it — the strongest case in this bag for an app read.",
    },
    venueSecurity: { status: "live", readers: ["organizer", "app"], why: "Part of the emergency card on Home." },
    medicalPoint: { status: "live", readers: ["organizer", "app"], why: "Part of the emergency card on Home." },
    assemblyPoint: { status: "live", readers: ["organizer", "app"], why: "Part of the emergency card on Home." },
    onSiteLead: { status: "live", readers: ["organizer", "app"], why: "Part of the emergency card on Home." },
    onSiteLeadPhone: { status: "live", readers: ["organizer", "app"], why: "Part of the emergency card on Home." },
    incidentProcedure: {
      status: "live",
      readers: ["organizer", "app"],
      why:
        "Rendered under 'If something happens' on the app's emergency card. If it ever " +
        "carries something internal, project the bag rather than widening the rule.",
    },
    planReady: {
      status: "live",
      readers: ["organizer", "app"],
      /*
       * `planReady` is the organizer's own assertion, so the dashboard reading
       * it back is a real consumer rather than a placeholder — Content ›
       * Logistics Center reports on it. It is also the gate FU-12 must respect:
       * an app that shows a half-filled emergency card during an emergency is
       * worse than one that shows none.
       */
      why:
        "Content › Logistics Center reports whether the card is ready, and the app's " +
        "emergency card refuses to render without it — a half-filled card during an " +
        "emergency is worse than none.",
    },
  },
  /*
   * Every field resolves through `resolveEventBasics()`, which falls back to
   * the constants in `event.ts` — so an unset field is the old behaviour, not a
   * blank. `firestore.rules` lets any client read this bag and the two beside
   * it in `PUBLIC_SETTINGS_KEYS`; all three hold only what the public site prints.
   */
  event: {
    name: { status: "live", readers: ["organizer", "web", "app"], why: "The dashboard masthead, the website titles and hero, the app Home header." },
    shortName: { status: "live", readers: ["organizer", "web", "app"], why: "The short form in page titles and the app." },
    startDate: { status: "live", readers: ["organizer", "web", "app"], why: "The date range on the masthead, the website and the app." },
    endDate: { status: "live", readers: ["organizer", "web", "app"], why: "The date range on the masthead, the website and the app." },
    timeZone: {
      status: "live",
      readers: ["organizer", "web"],
      why:
        "Session times are authored as wall clock in this zone. Saving a new zone re-derives " +
        "every session's start and end, and the website agenda formats in it.",
    },
    venue: { status: "live", readers: ["organizer", "web", "app"], why: "Printed beside the dates on all three surfaces." },
    eventType: {
      status: "live",
      readers: ["organizer", "web"],
      why: "The masthead badge, and the attendance mode in the website's structured data.",
    },
  },
  sponsorTiers: {
    tiers: {
      status: "live",
      readers: ["organizer", "web", "app"],
      why:
        "Sponsor Manager's tier select, the website's sponsor bands and the app's sponsor " +
        "list all group with groupSponsorsByTier() over this list.",
    },
  },
  attendeeCategories: {
    categories: {
      status: "live",
      readers: ["organizer", "app"],
      why:
        "The attendee list, the exports and the printed badge read the list. The app prints " +
        "the name copied onto the holder's registration.",
    },
    ticketRules: {
      status: "live",
      readers: ["organizer", "web"],
      why: "ensureRegistration applies it on every purchase, import and hand-added attendee.",
    },
  },
};

/** The facts for one field. Narrow, so a screen cannot mistype a field name. */
export function settingsField<K extends SettingsKey, F extends keyof SettingsValues[K]>(
  key: K,
  field: F,
): SettingsFieldFacts {
  return SETTINGS_REGISTER[key][field];
}

/**
 * Whether *any* field of a bag reaches a surface outside the dashboard.
 *
 * Used by the screens to decide between "Saved" and "Recorded" in a save
 * message, so the wording follows the register rather than somebody's memory of
 * it.
 */
export function settingsBagIsConsumed(key: SettingsKey): boolean {
  return Object.values(SETTINGS_REGISTER[key] as Record<string, SettingsFieldFacts>).some(
    (f) => f.status === "live" && f.readers.some((r) => r !== "organizer"),
  );
}
