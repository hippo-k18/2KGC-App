import type { Metadata } from 'next';
import { PastSpeakerDirectory } from '@/components/past-speaker-directory';
import { PAST_SPEAKERS, PAST_YEARS } from '@/lib/past-speakers';

export const metadata: Metadata = {
  title: { absolute: 'Past speakers · Knowledge Graph Conference' },
  description: `All ${PAST_SPEAKERS.length} people who spoke at the Knowledge Graph Conference from ${PAST_YEARS.at(-1)?.year} to ${PAST_YEARS[0]?.year}, with their biographies and talks. Search by name or company, or browse by year.`,
  alternates: { canonical: '/past-speakers' },
};

/**
 * Everyone. One year's list is `/past-speakers?year=2022`, which
 * `next.config.ts` serves from `[slug]` so that it is static too.
 */
export default function PastSpeakersPage() {
  return <PastSpeakerDirectory />;
}
