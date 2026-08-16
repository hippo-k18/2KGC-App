import { useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { EmptyState } from '@/components/empty-state';
import { FilterChip } from '@/components/filter-chip';
import { ListRow } from '@/components/list-row';
import { ScreenHeader } from '@/components/screen-header';
import { Text } from '@/components/text';
import { HAIRLINE, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth/auth-provider';
import { CATEGORIES, categoryLabel, createPost, useCommunityPosts } from '@/lib/data/community';

/**
 * The community board.
 *
 * Categories are fixed rather than free-form, which is what keeps a board of
 * this size navigable — "ride share" and "travel" as separate user-invented
 * topics is how these turn into noise by day two.
 */
export default function CommunityScreen() {
  const colors = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const [category, setCategory] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  const { posts, loading } = useCommunityPosts(category);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader
        title="Community"
        trailing={
          user ? (
            <Pressable
              onPress={() => setComposing(true)}
              accessibilityRole="button"
              accessibilityLabel="New post"
              hitSlop={12}>
              <Text variant="title3" tone="tint">
                +
              </Text>
            </Pressable>
          ) : undefined
        }
      />

      <View style={{ gap: 12, paddingTop: 12 }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: Spacing.md, gap: Spacing.sm }}>
          <FilterChip label="All" selected={category === null} onPress={() => setCategory(null)} />
          {CATEGORIES.map((c) => (
            <FilterChip
              key={c.id}
              label={c.label}
              selected={category === c.id}
              onPress={() => setCategory(category === c.id ? null : c.id)}
            />
          ))}
        </ScrollView>
        <View style={{ height: HAIRLINE, backgroundColor: colors.border }} />
      </View>

      <FlatList
        data={posts ?? []}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{
          paddingHorizontal: Spacing.md,
          paddingTop: Spacing.md,
          paddingBottom: Spacing.xxl,
        }}
        renderItem={({ item, index }) => (
          <ListRow
            title={item.title}
            subtitle={item.body}
            meta={`${categoryLabel(item.category)}  ·  ${item.replyCount} ${
              item.replyCount === 1 ? 'reply' : 'replies'
            }`}
            first={index === 0}
            last={index === (posts?.length ?? 0) - 1}
            onPress={() =>
              router.push({ pathname: '/community/[id]', params: { id: item.id } })
            }
          />
        )}
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              icon="bubble.left.and.bubble.right"
              title={category ? 'Nothing here yet' : 'No posts yet'}
              message="Start a meet-up, ask a question, or offer a ride from the tram."
            />
          )
        }
      />

      <Composer
        visible={composing}
        onClose={() => setComposing(false)}
        onSubmit={async (title, body, cat) => {
          if (!user) return;
          await createPost({ authorId: user.uid, category: cat, title, body });
          setComposing(false);
        }}
      />
    </View>
  );
}

function Composer({
  visible,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (title: string, body: string, category: string) => Promise<void>;
}) {
  const colors = useTheme();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<string>(CATEGORIES[0].id);
  const [busy, setBusy] = useState(false);

  const field = {
    backgroundColor: colors.surface,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 17,
    color: colors.text,
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: colors.background, padding: Spacing.md, gap: Spacing.md }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={12}>
            <Text tone="tint">Cancel</Text>
          </Pressable>
          <Text variant="heading">New post</Text>
          <Pressable
            disabled={busy || !title.trim() || !body.trim()}
            onPress={async () => {
              setBusy(true);
              try {
                await onSubmit(title.trim(), body.trim(), category);
                setTitle('');
                setBody('');
              } finally {
                setBusy(false);
              }
            }}
            accessibilityRole="button"
            hitSlop={12}>
            <Text tone="tint" style={{ opacity: title.trim() && body.trim() ? 1 : 0.4 }}>
              Post
            </Text>
          </Pressable>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: Spacing.sm }}>
          {CATEGORIES.map((c) => (
            <FilterChip
              key={c.id}
              label={c.label}
              selected={category === c.id}
              onPress={() => setCategory(c.id)}
            />
          ))}
        </ScrollView>

        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Title"
          placeholderTextColor={colors.textTertiary}
          style={field}
          accessibilityLabel="Post title"
          maxLength={120}
        />
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder="Say a bit more…"
          placeholderTextColor={colors.textTertiary}
          style={[field, { minHeight: 140, textAlignVertical: 'top' }]}
          multiline
          accessibilityLabel="Post body"
          maxLength={2000}
        />
      </View>
    </Modal>
  );
}
