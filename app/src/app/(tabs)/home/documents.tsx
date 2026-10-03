import { Linking, View } from 'react-native';
import { useRouter } from 'expo-router';

import { DataError } from '@/components/data-error';
import { EmptyState } from '@/components/empty-state';
import { Chevron } from '@/components/icon';
import { ListRow } from '@/components/list-row';
import { PushedHeader } from '@/components/pushed-header';
import { Screen } from '@/components/screen';
import { SkeletonBlock, SkeletonScreen } from '@/components/skeleton';
import { Text } from '@/components/text';
import { Radius, Spacing } from '@/constants/theme';
import { kindLabel, linkHost, openable, useDocuments } from '@/lib/data/documents';
import { readable, usePages } from '@/lib/data/pages';

/**
 * The event's handouts — slide decks, datasets, the code of conduct.
 *
 * ## Why this screen did not exist until now
 *
 * `documents/{id}` has been seeded, written by the dashboard's Content ›
 * Documents and rendered on the public website for months. The only thing
 * keeping it off the phone was that `firestore.rules` had no `match` block for
 * it, so the default-closed posture refused every read. The block exists now
 * and this screen is what it was opened for.
 *
 * ## It shows a subset, and says nothing about the rest
 *
 * A handout restricted to a ticket type does not reach this list — the rules
 * cannot serve it, because ticket tier is not a claim on the sign-in token and
 * rules filter documents rather than fields. See `lib/data/documents.ts`.
 *
 * Nothing on screen mentions that. `AGENTS.md` counts fourteen cases of this app
 * claiming capabilities it does not have, and the inverse — a screen narrating
 * what the software cannot do to the one person who can do nothing about it —
 * is the same defect wearing the opposite sign. For almost every reader the
 * list is complete; for the rest, the thing to fix is on the dashboard, and the
 * dashboard says so.
 *
 * ## Every row opens something off-site
 *
 * These are links, not uploads: `DocumentDoc.url` points at a file somebody else
 * is hosting. So the host is printed under each title — tapping a row hands the
 * reader to a browser, and which server they are about to reach is theirs to
 * know first. A row whose URL is not openable is left out rather than rendered
 * inert; `openable()` holds that reasoning.
 */
export default function DocumentsScreen() {
  const router = useRouter();
  const { documents, error, status, retry } = useDocuments();
  const { pages } = usePages();

  if (error) {
    return (
      <>
        <PushedHeader backTitle="Home" backHref="/home" />
        <Screen grouped>
          <DataError error={error} subject="the documents" onRetry={retry} />
        </Screen>
      </>
    );
  }

  if (status === 'loading') {
    return (
      <>
        <PushedHeader backTitle="Home" backHref="/home" />
        <Screen grouped>
          <SkeletonScreen
            label="the documents"
            slowNotice="Still loading. Check your connection.">
            <SkeletonBlock width="40%" height={26} />
            <SkeletonBlock height={64} radius={Radius.lg} />
            <SkeletonBlock height={64} radius={Radius.lg} />
          </SkeletonScreen>
        </Screen>
      </>
    );
  }

  const rows = (documents ?? []).filter(openable);
  // A page listener failing is not a reason to withhold the handouts, so this
  // screen reads `pages` without a second error branch: an unreadable set is an
  // absent section, and the handouts below it still render.
  const pageRows = (pages ?? []).filter(readable);

  return (
    <>
      <PushedHeader backTitle="Home" backHref="/home" />

      <Screen grouped>
        <View style={{ gap: Spacing.xs }}>
          <Text variant="title" accessibilityRole="header">
            Documents
          </Text>
          <Text variant="subhead" tone="secondary">
            {pageRows.length
              ? 'What the organizers have published. Handouts open in your browser.'
              : 'Handouts the organizers have published. Each one opens in your browser.'}
          </Text>
        </View>

        {/*
          The organizer's own pages, above the handouts.

          They come first because the questions they answer — where is the
          venue, what is the Wi-Fi, how do I get there — are the ones somebody
          opens this screen in a hurry to answer, and because they open in the
          app rather than throwing the reader into a browser. The section
          disappears entirely when nothing is published, rather than sitting
          there as an empty heading.
        */}
        {pageRows.length ? (
          <View style={{ gap: Spacing.sm }}>
            <Text variant="label" tone="secondary">
              EVENT INFORMATION
            </Text>
            <View style={{ borderRadius: Radius.lg, overflow: 'hidden' }}>
              {pageRows.map((p, i, arr) => (
                <ListRow
                  key={p.id}
                  title={p.title}
                  subtitle={p.summary}
                  trailing={<Chevron />}
                  first={i === 0}
                  last={i === arr.length - 1}
                  onPress={() =>
                    router.push({ pathname: '/home/page/[slug]', params: { slug: p.slug } })
                  }
                />
              ))}
            </View>
          </View>
        ) : null}

        {pageRows.length && rows.length ? (
          <Text variant="label" tone="secondary">
            HANDOUTS
          </Text>
        ) : null}

        {rows.length ? (
          <View style={{ borderRadius: Radius.lg, overflow: 'hidden' }}>
            {rows.map((d, i, arr) => (
              <ListRow
                key={d.id}
                title={d.title}
                subtitle={d.description}
                // The host goes in `meta` rather than into the subtitle, so it
                // is on every row whether or not the organizer wrote a sentence
                // — and `ListRow` reads `meta` out with the title, which is how
                // a screen reader user learns where the row is about to send
                // them. The kind joins it when it says something: "PDF" is
                // worth 40pt of row, "Link" is not.
                meta={[kindLabel(d.kind), linkHost(d.url)].filter(Boolean).join(' · ')}
                trailing={<Chevron />}
                first={i === 0}
                last={i === arr.length - 1}
                // `openURL` rejects on an address the platform cannot handle.
                // `openable()` has already dropped the shapes that reliably
                // fail, so this catch is for the rest — a phone with no
                // browser, a URL the OS refuses — and it must not become an
                // unhandled rejection out of a press handler.
                onPress={() => {
                  Linking.openURL(d.url).catch((e: unknown) => {
                    console.warn('[documents] could not open', d.url, e);
                  });
                }}
              />
            ))}
          </View>
        ) : pageRows.length === 0 ? (
          <EmptyState
            icon="newspaper"
            title="Not inputted yet"
            message={
              'Handouts, slides and datasets appear here once the organizers publish them.'
            }
          />
        ) : null}
      </Screen>
    </>
  );
}
