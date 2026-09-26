import { Platform, View } from 'react-native';

import { publicSiteOrigin } from '@kgc/shared';

import { Text } from '@/components/text';
import { VideoEmbed, WatchElsewhereButton } from '@/components/video-embed';
import { HAIRLINE, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSessionWatch } from '@/lib/data/watch';
import type { Session } from '@/lib/data/sessions';
import type { WatchPanel } from '@/lib/data/watch-core';

/**
 * Watching a session, on the session's own screen.
 *
 * ── It disappears rather than sitting there empty ───────────────────────────
 *
 * Most talks at this conference are in a room and nowhere else, and a "Watch"
 * heading over the words "no stream" on sixty of seventy-two sessions is
 * chrome, not information. So the whole block is absent when nothing has been
 * set up. Every state that *is* set up gets a sentence: `watch-core.ts` lists
 * the six of them and what each one says.
 *
 * The one case that is neither is a reader whose ticket does not cover it.
 * That draws the block, quietly, and names the tickets that do — the same
 * answer the capacity work gives on the button above, and for the same reason:
 * being refused with no account of why is the thing people report as broken.
 */
export function SessionWatch({ session }: { session: Session }) {
  const { stream, recording, any } = useSessionWatch(session);
  if (!any) return null;

  return (
    <View style={{ gap: Spacing.sm }}>
      <Text variant="heading" accessibilityRole="header">
        Watch
      </Text>
      {stream ? <WatchBlock panel={stream} title={session.title} /> : null}
      {recording ? <WatchBlock panel={recording} title={session.title} /> : null}
    </View>
  );
}

/**
 * One panel: a heading, a line, and whatever of a player and a link the state
 * has earned.
 *
 * The player is drawn only on the web, where an `iframe` is a real player.
 * On a phone the same panel keeps its sentence and offers the provider's own
 * app instead — see `video-embed.tsx` for why that is a deliberate ceiling and
 * not a gap. So the "open it elsewhere" button is shown on every platform when
 * there is somewhere to send the reader: on the web it is the second route, on
 * a phone it is the only one.
 */
export function WatchBlock({ panel, title }: { panel: WatchPanel; title: string }) {
  const colors = useTheme();
  const canPlayHere = Platform.OS === 'web' && panel.embedUrl;

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: Radius.md,
        borderWidth: HAIRLINE,
        borderColor: colors.border,
        padding: Spacing.md,
        gap: Spacing.sm,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
        {panel.live ? (
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: colors.danger,
            }}
          />
        ) : null}
        {/* The dot is decoration; the word "Live now" is what carries it, so a
            screen reader and a colour-blind reader get the same answer. */}
        <Text variant="label" tone="secondary">
          {panel.title.toUpperCase()}
        </Text>
      </View>

      {canPlayHere && panel.embedUrl ? (
        <VideoEmbed embedUrl={panel.embedUrl} title={title} />
      ) : null}

      <Text tone={panel.barred ? 'secondary' : 'primary'}>{panel.message}</Text>

      {panel.openUrl && panel.openLabel ? (
        <WatchElsewhereButton url={panel.openUrl} label={panel.openLabel} />
      ) : null}

      {/*
        Somewhere to go, for a reader who has just been refused.
        ⚠️ Being told which ticket you would need and then given nothing to
        press is the half of this that was missing: the sentence above names
        the tickets that include the video and the reader is left holding a
        phone with no next step. The website already does this — the same
        refusal there carries a See tickets button — so the two surfaces now
        end the same sentence the same way. It is shown only on a refusal, not
        on a closed library or a stream that has not started, because neither
        of those is fixed by buying anything.
      */}
      {panel.barred ? (
        <WatchElsewhereButton
          url={`${publicSiteOrigin()}/tickets`}
          label="See tickets"
          icon="ticket"
        />
      ) : null}
    </View>
  );
}
