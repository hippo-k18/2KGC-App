/**
 * Values printed in the demo panel.
 *
 * A separate module from `demo.ts` because that one is `server-only` and the
 * checkout form is a client component — `server-only` is not a convention, it
 * throws at build time, and importing a constant across that line fails the
 * whole build with an error that names the import rather than the boundary.
 */
/**
 * The details printed in the panel at the bottom of the screen, so nobody has
 * to invent an email address while a room watches.
 *
 * The card number is Stripe's published test PAN. It is here because a payment
 * form with an empty card box does not read as a payment form — not because
 * anything validates it. Nothing does; these values are never submitted.
 */
export const DEMO_BUYER = {
  name: 'Ada Okonkwo',
  email: 'ada.okonkwo@example.com',
  card: '4242 4242 4242 4242',
  expiry: '12 / 29',
  cvc: '123',
  postcode: '10044',
} as const;
