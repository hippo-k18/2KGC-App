import { SOCIAL_CATEGORIES } from '@/lib/engagement';
import { CategoryScreen } from '../category-screen';

export const dynamic = 'force-dynamic';

/** Engagement › Community › Social Groups. */
export default async function SocialGroupsPage() {
  return (
    <CategoryScreen
      title="Social Groups"
      categories={SOCIAL_CATEGORIES}
      intro="Ride shares, jobs and lost-and-found — the practical corners of the board. Whova models these as joinable groups with their own membership; ours are categories on shared posts, so there is nothing to join and no member list."
      notBuilt={[
        'Group membership. A social group here is a category, not an object with members, so nobody can join one and nothing can message its members.',
        'Private groups. Every post on this board is readable by every ticket holder.',
        'Group chat. Direct messages exist between two people; there is no group thread.',
      ]}
    />
  );
}
