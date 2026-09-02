/**
 * What every install says about the public side of this event: where the
 * website lives, and how an attendee actually gets the app.
 *
 * The website, the dashboard, `@kgc/scripts` and the app are four separate npm
 * installs that cannot import each other — the same constraint that put
 * `COLLECTIONS`, `EVENT_ID` and the `settings` contract here. Both facts below
 * were previously restated at every call site, and both had already drifted.
 *
 * ── The origin had two defaults, and the split was visible on one screen ────
 *
 * `WEB_PUBLIC_ORIGIN` was read at fifteen places with two different hardcoded
 * fallbacks: eight defaulted to production and seven to `http://localhost:3200`.
 * On the deployed dashboard that meant Event Webpages showed an organizer the
 * production origin while Campaign Link Tracking, Social Sharing and Referral
 * Contest handed them `http://localhost:3200/r/CODE` links to publish — for the
 * same site, in the same session. Fifteen defaults that agree do so by luck.
 *
 * ── The app sentence is a claim about the world, not copy ───────────────────
 *
 * It is printed on the confirmation page every buyer reads and pasted into the
 * emails this dashboard sends. It was two copies, each with a comment saying
 * the other one existed. See `APP_DISTRIBUTION` for what it is load-bearing
 * about.
 */

/**
 * Where the public website lives when nothing says otherwise.
 *
 * Production rather than `localhost`, and that asymmetry is the whole point: a
 * deployment missing the variable then emits a wrong-but-plausible public URL,
 * which somebody notices and fixes, while a `localhost` URL published to
 * attendees or emitted as `schema.org` markup is dead for everyone who is not
 * the person who built it. Local work sets the variable; an unset variable
 * should degrade towards the real site, never towards one machine.
 *
 * `EVENT.website` is the same host with a trailing slash and is deliberately
 * not reused here: that constant is the conference's front door as displayed,
 * this is the origin *this* deployment serves from, and on a preview build or a
 * Netlify subdomain the two are different things.
 */
const DEFAULT_ORIGIN = "https://www.knowledgegraph.tech";

/**
 * The public website's origin, with no trailing slash.
 *
 * Read from the environment and never from a request's `Host` header: a page
 * cached behind a proxy would otherwise mint a canonical URL from a host
 * somebody else chose, and the dashboard has no request to read at all at the
 * moment it mails a link out.
 *
 * The `process.env` lookup is the only one in `@kgc/shared`, and it is inside
 * the function rather than at module scope so importing this package still
 * touches no globals — the app bundles it and never calls this.
 *
 * ⚠️ `process` is declared locally rather than by adding `@types/node` to this
 * package. Every other module here is plain TypeScript that the Expo bundler,
 * Cloud Functions and both Next apps all compile unchanged, and pulling Node's
 * global types in to satisfy one line would let the next author reach for
 * `fs` or `Buffer` and still typecheck — in a package React Native bundles.
 * The optional chain is not defensive dressing either: on a device `process`
 * may be a shim with no `env`, and this returning the production origin is
 * better than it throwing inside a component tree.
 */
declare const process: { env?: Record<string, string | undefined> } | undefined;

export function publicSiteOrigin(): string {
  const configured = typeof process === "undefined" ? undefined : process?.env?.WEB_PUBLIC_ORIGIN;
  return (configured ?? DEFAULT_ORIGIN).replace(/\/$/, "");
}

/**
 * How an attendee actually gets the app, stated as one editable sentence.
 *
 * The confirmation page used to say "Search 'Knowledge Graph Conference' on the
 * App Store or Google Play". The app is published to neither — it runs in Expo
 * Go — so every purchaser was being sent to a store search that returns nothing,
 * on the one page they are guaranteed to read. The dashboard's App Adoption
 * screens hand an organizer the same sentence to paste in front of a thousand
 * people, which is why the two surfaces must not be able to disagree about it.
 *
 * It is a claim about the world that only the owner can make true. Change it
 * here on the day the app is actually listed, and not before.
 */
export const APP_DISTRIBUTION =
  "We will send you an install link before the conference. The app is not on the public app stores yet.";
