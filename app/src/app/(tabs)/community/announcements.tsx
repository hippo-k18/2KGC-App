import { FlatList, View } from 'react-native';

import { CATEGORY_TILE, CategoryTile } from '@/components/category-tile';
import { DataError } from '@/components/data-error';
import { EmptyState } from '@/components/empty-state';
import { PushedHeader } from '@/components/pushed-header';
import { Text } from '@/components/text';
import { HAIRLINE, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAnnouncements } from '@/lib/data/announcements';

import { relative } from './index';

/**
 * The board behind Whova's pinned "Organizer Announcements" row.
 *
 * Whova's Community tab opens with a pinned, organizer-only board that
 * attendees can read but not post to, and it is the only genuinely *pinned*
 * thing this app has data for — `announcements` is exactly that collection.
 * Community's pinned row would otherwise be a control that goes nowhere.
 *
 * Read-only by construction: `firestore.rules` allows organizers to write
 * announcements and everyone else only to read them, so there is no composer
 * here and no empty "reply" affordance pretending otherwise.
 *
 * No new query — `useAnnouncements()` is the same listener the Home screen
 * already holds, so opening this screen costs nothing beyond the render.
 */
export default function AnnouncementsScreen() {
  const colors = useTheme();
  const { announcements, error, retry } = useAnnouncements();

  return (
    <>
      <PushedHeader title="Announcements" backTitle="Community" backHref="/community" />
      <FlatList
        style={{ flex: 1, backgroundColor: colors.background }}
        data={announcements}
        keyExtractor={(a) => a.id}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: Spacing.xxl }}
        renderItem={({ item }) => (
          <View style={{ backgroundColor: colors.surface }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: Spacing.sm + Spacing.xs,
                paddingHorizontal: Spacing.md,
                paddingVertical: Spacing.md,
              }}>
              <CategoryTile icon="megaphone" tint="red" />
              <View style={{ flex: 1, gap: Spacing.xs }}>
                <Text variant="heading">{item.title}</Text>
                {/* Uncapped. This is the screen someone opens to read a room
                    change in full; two lines of it is not an announcement. */}
                <Text variant="subhead" tone="secondary">
                  {item.body}
                </Text>
                <Text variant="subhead" tone="tertiary">
                  {relative(item.createdAt)}
                </Text>
              </View>
            </View>

            {/* Inset left to the text column, `Spacing.md` off the right edge. */}
            <View
              style={{
                height: HAIRLINE,
                backgroundColor: colors.separator,
                marginLeft: Spacing.md + CATEGORY_TILE + Spacing.sm + Spacing.xs,
                marginRight: Spacing.md,
              }}
            />
          </View>
        )}
        ListEmptyComponent={
          // "No announcements yet" over a refused read is the most costly version
          // of this bug in the app: this is the screen an attendee opens to check
          // whether a room has moved.
          error ? (
            <DataError error={error} subject="organizer announcements" onRetry={retry} />
          ) : (
            <EmptyState
              icon="megaphone"
              title="No announcements yet"
              message="Organizer notices about room changes, wifi and timings appear here."
            />
          )
        }
      />
    </>
  );
}
