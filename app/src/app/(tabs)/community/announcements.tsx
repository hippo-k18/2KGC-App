import { FlatList, View } from 'react-native';
import { Stack } from 'expo-router';

import { CategoryTile } from '@/components/category-tile';
import { EmptyState } from '@/components/empty-state';
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
  const announcements = useAnnouncements();

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Announcements',
          headerBackTitle: 'Community',
        }}
      />
      <FlatList
        style={{ flex: 1, backgroundColor: colors.background }}
        data={announcements}
        keyExtractor={(a) => a.id}
        contentContainerStyle={{ paddingBottom: Spacing.xxl }}
        renderItem={({ item }) => (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: Spacing.sm + Spacing.xs,
              paddingHorizontal: Spacing.md,
              paddingVertical: Spacing.md,
              backgroundColor: colors.surface,
              borderBottomWidth: HAIRLINE,
              borderBottomColor: colors.separator,
            }}>
            <CategoryTile icon="megaphone" tint="red" />
            <View style={{ flex: 1, gap: Spacing.xs }}>
              <Text variant="heading">{item.title}</Text>
              <Text variant="subhead" tone="secondary">
                {item.body}
              </Text>
              <Text variant="caption" tone="tertiary">
                {relative(item.createdAt)}
              </Text>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <EmptyState
            icon="megaphone"
            title="No announcements yet"
            message="Organizer notices about room changes, wifi and timings appear here."
          />
        }
      />
    </>
  );
}
