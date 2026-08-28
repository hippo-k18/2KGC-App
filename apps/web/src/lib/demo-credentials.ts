/**
 * Values printed in the demo panel.
 *
 * A separate module from `demo.ts` because that one is `server-only` and the
 * checkout form is a client component — `server-only` is not a convention, it
 * throws at build time, and importing a constant across that line fails the
 * whole build with an error that names the import rather than the boundary.
 */
/**
 * The details printed in the panel beside the card box, so nobody has to invent
 * an email address while a room watches.
 *
 * The name and address say "demo" rather than naming an invented person. The
 * previous value was a plausible human name, which is the wrong thing for a
 * buyer whose registration, order and badge all end up in the live project and
 * on the organizer dashboard next to real ones: anybody reading that list later
 * has to work out whether a person by that name exists. "Demo Attendee" needs
 * no such judgement.
 *
 * The email is load-bearing, not decoration — `registrationId` is
 * `sha256(email)`, so changing it changes which registration a demo purchase
 * writes. Purchases made under the old address are still in Firestore under
 * their own id; they are simply no longer the one this button reaches.
 *
 * The card number is Stripe's published test PAN. It is here because a payment
 * form with an empty card box does not read as a payment form — not because
 * anything validates it. Nothing does; these values are never submitted.
 */
export const DEMO_BUYER = {
  name: 'Demo Attendee',
  email: 'demo.attendee@example.com',
  card: '4242 4242 4242 4242',
  expiry: '12 / 29',
  cvc: '123',
  postcode: '10044',
} as const;

/**
 * The password set on an account created by a demo purchase, and printed on the
 * confirmation page.
 *
 * The same value `scripts/src/set-claims.ts` puts on the fifty seeded
 * attendees, so the app's login screen can print one password that works for
 * everybody — a seeded attendee and somebody who bought a ticket thirty seconds
 * ago. Two different demo passwords is a question from the audience you do not
 * want to be answering.
 */
export const DEMO_APP_PASSWORD = 'kgcdemo2027';
