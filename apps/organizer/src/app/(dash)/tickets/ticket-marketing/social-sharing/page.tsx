import { GapScreen } from '../../../gap-screen';

export const dynamic = 'force-dynamic';

/** Tickets › Social Sharing. */
export default async function Page() {
  return (
    <GapScreen
      title="Social Sharing"
      lead={<>Not built, and sized honestly rather than promised. What it would actually take is below.</>}
      whova={<>A share button on the ticket confirmation, and prewritten posts for registrants.</>}
      needs={<>Half of it exists in the wrong place: Tools › App Adoption › Social Media has the prewritten posts. What is missing is anything on the public site that prompts a buyer to share after purchasing.</>}
      size="1–2 days on the website, not this console."
      notBuilt={[
        <><strong>The confirmation page is the moment</strong> — somebody who has just bought is the likeliest person to post about it, and <code>/order/[token]</code> says nothing about sharing.</>,
        <><strong>Open Graph tags</strong> on the tickets page would matter more than a button, and are a website change.</>,
      ]}
    />
  );
}
