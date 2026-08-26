import { GapScreen } from '../../gap-screen';

export const dynamic = 'force-dynamic';

/** Tickets › Payout. */
export default async function Page() {
  return (
    <GapScreen
      title="Payout"
      lead={<>Not built, and sized honestly rather than promised. What it would actually take is below.</>}
      whova={<>Where Whova sends your ticket money, and when.</>}
      needs={<>Nothing here — and that is the design. Stripe is the merchant of record and pays out to KGC&rsquo;s bank directly, which is the main reason this project does not use a ticketing platform: Eventbrite holds ticket money until after the event, and Stripe pays on a rolling basis as tickets sell.</>}
      size="Not applicable. Pay › Balance shows what was sold and links to Stripe for the authoritative figure."
      notBuilt={[
        <><strong>Payout settings live in Stripe</strong>, behind their login and their two-factor. Pay › Billing Information explains why a bank-account form does not belong behind a shared passphrase.</>,
        <><strong>PAYMENTS.md</strong> works through the comparison, which came out at roughly $30,000 across a thousand tickets.</>,
      ]}
    />
  );
}
