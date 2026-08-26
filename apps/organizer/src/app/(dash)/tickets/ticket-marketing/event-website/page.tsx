import { GapScreen } from '../../../gap-screen';

export const dynamic = 'force-dynamic';

/** Tickets › Event Website. */
export default async function Page() {
  return (
    <GapScreen
      title="Event Website"
      lead={<>Not built, and sized honestly rather than promised. What it would actually take is below.</>}
      whova={<>Whova&rsquo;s hosted one-page event site, from the marketing side.</>}
      needs={<>Nothing here, because Marketing › Event Website already covers it — KGC has a real nineteen-page site at knowledgegraph.tech, three pages of which render live from this dashboard.</>}
      size="Not applicable. This nav entry duplicates one that exists."
      notBuilt={[
        <><strong>Whova lists the same screen twice</strong>, once under Tickets and once under Marketing. Ours lives under Marketing.</>,
        <><strong>Sixteen of the nineteen pages are React files</strong>, so editing them is a deploy. A CMS is ROADMAP.md Phase 5.</>,
      ]}
    />
  );
}
