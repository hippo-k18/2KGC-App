import { createElement } from 'react';
import { Linking, Platform, Pressable, View } from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import { Text } from '@/components/text';
import { HIT_TARGET, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * A session's video, in the provider's own player.
 *
 * ── Why there is no video dependency in this app ────────────────────────────
 *
 * Nothing here decodes video. The embed URL stored beside the session is
 * YouTube's or Vimeo's own player page, and on the web it goes straight into an
 * `iframe`: the provider handles the adaptive bitrate, the captions, the
 * fullscreen button and the licence to stream their content, and the app
 * handles none of it.
 *
 * On a phone there is deliberately no in-app player, and the reason is not
 * taste. A framed player on React Native needs `react-native-webview`, and
 * `AGENTS.md` gotcha 1 pins this project to Expo Go's fixed set of native
 * modules so the app stays openable without a development build — adding one is
 * a decision about how the whole app ships, not a decision about this screen.
 * `expo-video` is the same trade and worse: it would want the raw media URL,
 * which is exactly what a YouTube or Vimeo link is not.
 *
 * So the phone hands the video to the provider's own app, which is where a
 * signed-in viewer's quality settings, captions and playback position already
 * live, and it says so before it does — the same courtesy the Documents screen
 * pays by printing the host under every handout. When this app moves to a
 * development build, the honest upgrade is a `WebView` here and nothing else
 * changing: every caller already passes a normalised embed URL.
 *
 * ── The frame is sandboxed, and the URL is checked twice ────────────────────
 *
 * The URL has already been normalised by `parseStreamSource` on the way in and
 * checked again by `playableUrl` on the way out, so an `iframe` can never be
 * handed a `javascript:` string. `sandbox` is set anyway, because the page
 * inside is a third party's and the app's own origin holds a signed-in
 * Firebase session: the frame may run scripts and go fullscreen, and it may not
 * reach back into this document or navigate the top window.
 */

/** 16:9. Every provider's player is this, and a letterboxed frame is fine. */
const ASPECT = 16 / 9;

/**
 * The frame stops growing here, and everything else on the screen does not.
 *
 * A 16:9 box that fills the width is 219pt tall on a phone and 720 in a
 * browser window — the whole viewport, with the session's own title scrolled
 * off the top. Every other block in this app is happy full-bleed because its
 * height comes from its text; a video's height comes from its width, so it is
 * the one thing that needs a ceiling. 640 is about the width a person watches
 * a conference talk at before they go fullscreen, which the player's own
 * button does properly.
 */
const MAX_WIDTH = 640;

export function VideoEmbed({
  embedUrl,
  title,
}: {
  /** Already checked by `playableUrl`. */
  embedUrl: string;
  /** What the frame is called, for a screen reader and for the browser. */
  title: string;
}) {
  const colors = useTheme();

  if (Platform.OS !== 'web') return null;

  return (
    <View
      style={{
        width: '100%',
        maxWidth: MAX_WIDTH,
        aspectRatio: ASPECT,
        borderRadius: Radius.md,
        overflow: 'hidden',
        backgroundColor: colors.surfacePressed,
      }}>
      {createElement('iframe', {
        src: embedUrl,
        title,
        // `frameBorder` is the attribute every provider's own snippet sets;
        // the border is removed in CSS as well, because Firefox ignores one of
        // the two depending on which way the page was styled.
        frameBorder: '0',
        allow: 'accelerometer; encrypted-media; picture-in-picture; fullscreen',
        allowFullScreen: true,
        referrerPolicy: 'strict-origin-when-cross-origin',
        sandbox: 'allow-scripts allow-same-origin allow-presentation allow-popups',
        style: { width: '100%', height: '100%', border: 'none', display: 'block' },
      })}
    </View>
  );
}

/**
 * The way out to the provider — a phone's only player, and a second route on
 * the web for anyone who would rather watch it full size.
 *
 * `openURL` rejects on an address the platform cannot handle, and out of a
 * press handler that is an unhandled rejection: a red box in development and
 * silence here.
 */
export function WatchElsewhereButton({
  url,
  label,
  icon = 'video.fill',
}: {
  url: string;
  label: string;
  /** Defaults to the player glyph; a link that is not a player passes its own. */
  icon?: IconName;
}) {
  const colors = useTheme();

  return (
    <Pressable
      onPress={() => {
        Linking.openURL(url).catch((e: unknown) => {
          console.warn('[watch] could not open', url, e);
        });
      }}
      accessibilityRole="link"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        backgroundColor: pressed ? colors.surfacePressed : colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: Radius.md,
        paddingVertical: Spacing.md,
        paddingHorizontal: Spacing.md,
        minHeight: HIT_TARGET,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: Spacing.sm,
      })}>
      <Icon name={icon} size={20} color={colors.tint} />
      <Text variant="heading" tone="tint" style={{ flexShrink: 1 }}>
        {label}
      </Text>
    </Pressable>
  );
}
