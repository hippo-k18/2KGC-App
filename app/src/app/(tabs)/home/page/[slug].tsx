import { useLocalSearchParams } from 'expo-router';

import { DataError } from '@/components/data-error';
import { EmptyState } from '@/components/empty-state';
import { PushedHeader } from '@/components/pushed-header';
import { RichText } from '@/components/rich-text';
import { Screen } from '@/components/screen';
import { SkeletonBlock, SkeletonScreen } from '@/components/skeleton';
import { Text } from '@/components/text';
import { Radius, Spacing } from '@/constants/theme';
import { readable, usePages } from '@/lib/data/pages';

/**
 * One organizer-written page — Wi-Fi, getting here, the FAQ.
 *
 * ## Addressed by slug, not by document id
 *
 * The same string the website serves the page at. An organizer printing a QR
 * code to `/wifi` and a row in this app tapping through to the same text should
 * not be two different identifiers, and the slug is the one a human has seen.
 * It also means a page renamed in the dashboard changes both at once.
 *
 * ## No second listener
 *
 * `usePages` is already open on the Documents screen this was tapped from, and
 * the whole set is a handful of short documents, so the page is in memory
 * before the row is pressed. Opening a per-document listener here would add a
 * spinner to a screen that does not need one — and would need its own rule
 * exercise, since a `get` and a `list` are judged separately.
 */
export default function ContentPageScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { pages, error, status, retry } = usePages();

  if (error) {
    return (
      <>
        <PushedHeader backTitle="Documents" backHref="/home/documents" />
        <Screen grouped>
          <DataError error={error} subject="this page" onRetry={retry} />
        </Screen>
      </>
    );
  }

  if (status === 'loading') {
    return (
      <>
        <PushedHeader backTitle="Documents" backHref="/home/documents" />
        <Screen grouped>
          <SkeletonScreen label="this page" slowNotice="Still loading. Check your connection.">
            <SkeletonBlock width="60%" height={26} />
            <SkeletonBlock height={120} radius={Radius.lg} />
          </SkeletonScreen>
        </Screen>
      </>
    );
  }

  const page = (pages ?? []).filter(readable).find((p) => p.slug === slug);

  if (!page) {
    return (
      <>
        <PushedHeader backTitle="Documents" backHref="/home/documents" />
        <Screen grouped contentStyle={{ flexGrow: 1 }}>
          <EmptyState
            icon="newspaper"
            title="Page not found"
            message="The organizers may have taken this page down. Go back to Documents to see what is published."
          />
        </Screen>
      </>
    );
  }

  return (
    <>
      <PushedHeader backTitle="Documents" backHref="/home/documents" />
      <Screen grouped contentStyle={{ gap: Spacing.lg }}>
        <Text variant="title" accessibilityRole="header">
          {page.title}
        </Text>
        {page.summary ? (
          <Text variant="subhead" tone="secondary">
            {page.summary}
          </Text>
        ) : null}
        <RichText body={page.body} />
      </Screen>
    </>
  );
}
