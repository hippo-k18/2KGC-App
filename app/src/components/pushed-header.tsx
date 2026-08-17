import { HeaderBackContext } from '@react-navigation/elements';
import { useNavigationState } from '@react-navigation/native';
import { Link, Stack, router, type Href } from 'expo-router';
import { useContext, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { HIT_TARGET, Spacing } from '@/constants/theme';

/**
 * Height of the bar `NativeTabs` pins to the top of the window on web.
 *
 * `NativeTabs` renders a real bottom tab bar on iOS and Android. On web it
 * renders a Radix tab list with `position: fixed; top: 24px; height: 40px;
 * z-index: 10` — a pill floating over the top of the *whole viewport*, above
 * every screen in the app. Nothing measures it, so this is a constant; on
 * device the value is unused.
 *
 * `WhovaHeader` and `ScreenHeader` already paid this inset, which is why the
 * five tab roots looked right. Nothing paid it for the React Navigation header
 * that the pushed screens turn on, so their whole header — chevron included —
 * was drawn underneath the pill, where clicks land on the tab bar instead.
 */
export const WEB_TAB_BAR = 68;

/**
 * Top inset for a native-stack header, on web only.
 *
 * `headerStatusBarHeight` is an `@react-navigation/elements` header option that
 * native-stack 7 does not list in its own options type: on a device the header
 * is a real `UINavigationBar` and the value has nowhere to go. Its *web*
 * `NativeStackView` renders `elements`' JavaScript `Header` and spreads every
 * option it does not itself consume straight into it, so the option is honoured
 * there. That gap is the only reason this is a loose object rather than a
 * literal — spreading nothing on native is deliberate, so that the header keeps
 * its own default of `useSafeAreaInsets().top`.
 */
export const HEADER_WEB_INSET: { headerStatusBarHeight?: number } =
  Platform.OS === 'web' ? { headerStatusBarHeight: WEB_TAB_BAR } : {};

/**
 * Stack `screenOptions` for a navigator whose pushed screens show a header.
 *
 * Every nested stack in the app hides the header by default — the tab roots
 * draw their own `WhovaHeader` — and each pushed screen turns it back on with
 * `PushedHeader`. The web inset lives here rather than only in `PushedHeader`
 * so that a screen which sets `headerShown` some other way still gets it.
 */
export const pushedStackScreenOptions = {
  headerShown: false,
  ...HEADER_WEB_INSET,
};

interface PushedHeaderProps {
  /** Header title. Defaults to none, for screens whose content carries one. */
  title?: string;
  /**
   * The screen this one was pushed from, in words — "Agenda", "Me". Drawn
   * beside the chevron and spoken as "<name>, back".
   */
  backTitle: string;
  /**
   * Where back goes when there is nothing to pop, which is what happens on
   * every deep link and every browser refresh. Without it the only way off the
   * screen is the URL bar.
   */
  backHref: Href;
  /**
   * Set this when back really does land on `backTitle` even though that screen
   * is not below this one in *this* stack.
   *
   * Only the inbox can say so, and only because every tab's Messages action
   * passes a `from`. Everywhere else, a pushed screen with an empty stack of its
   * own pops the stack above and lands somewhere it has no way to name — so the
   * label falls back to a plain "Back" rather than claiming a destination it
   * cannot check.
   */
  popsToBackTitle?: boolean;
  /** Trailing action, drawn in the header's right slot. */
  headerRight?: () => ReactNode;
}

/**
 * The header for a screen that was pushed onto a nested stack.
 *
 * ## Why this exists rather than four lines of `<Stack.Screen options>`
 *
 * Three separate things were wrong with the per-screen options it replaces, and
 * all three are properties of *where the screen sits*, not of the screen:
 *
 * 1. **The chevron was drawn underneath the web tab bar.** `HEADER_WEB_INSET`
 *    is the fix. Before it, `document.elementFromPoint()` at the middle of the
 *    chevron returned the tab pill, so a real click switched tabs instead of
 *    going back — the chevron was unreachable on every pushed screen inside a
 *    tab.
 *
 * 2. **Screens reached by deep link had no back button at all.** React
 *    Navigation only draws one when the stack has something to pop or a parent
 *    supplies one; open `/agenda/<id>` in a fresh tab and the Agenda stack
 *    holds exactly one route. `backHref` gives those screens a real way out.
 *
 * 3. **The label leaked the router group name.** A pushed screen with nothing
 *    below it in its own stack inherits the *parent* stack's back target, and
 *    the parent's previous route is the group `(tabs)` — so `/messages`
 *    announced itself as "(tabs), back" and linked to whichever tab's URL
 *    happened to be sitting on the route params. Naming the destination here
 *    makes it deterministic.
 *
 * On iOS and Android the platform's own back button is left in place whenever
 * there is something to pop, so the native chrome and the swipe-back gesture
 * are untouched. The button below is used on web always, and on device only for
 * the deep-link case where the platform would otherwise draw nothing.
 */
export function PushedHeader({
  title = '',
  backTitle,
  backHref,
  popsToBackTitle = false,
  headerRight,
}: PushedHeaderProps) {
  // The same two conditions React Navigation uses to decide whether to draw a
  // back button at all (`NativeStackView`, `headerBack`): something below us in
  // this stack, or a back target handed down by the stack above.
  const stackIndex = useNavigationState((state) => state.index);
  const parentBack = useContext(HeaderBackContext);
  const canPopHere = stackIndex > 0;
  const canPop = canPopHere || parentBack != null;

  return (
    <Stack.Screen
      options={{
        headerShown: true,
        title,
        headerBackTitle: backTitle,
        ...HEADER_WEB_INSET,
        headerLeft:
          Platform.OS === 'web' || !canPop
            ? ({ tintColor }) => (
                <BackButton
                  // Popping the *parent* stack lands somewhere this screen
                  // cannot name — whichever tab you were on, which is not
                  // `backTitle`. Say the neutral thing rather than a confident
                  // wrong one, unless the caller knows better.
                  label={canPopHere || !canPop || popsToBackTitle ? backTitle : 'Back'}
                  href={backHref}
                  pop={canPop}
                  tintColor={tintColor}
                />
              )
            : undefined,
        headerRight,
      }}
    />
  );
}

/**
 * Chevron and label, wired to `router.back()` — or to `href` when there is no
 * history, which is the deep-link case.
 *
 * It is a `Link` so that web gets a real `<a href>`: the destination is
 * meaningful (it is where the button goes when the stack is empty), the control
 * is addressable as a link, and "open in new tab" does something sensible.
 * `event.preventDefault()` stops `Link`'s own navigation so an ordinary press
 * pops instead of pushing a second copy of the parent screen.
 *
 * Deliberately not `HeaderBackButton` from `@react-navigation/elements`: that
 * one defers its `onPress` through `requestAnimationFrame`, which never fires
 * while the document is hidden. A backgrounded browser tab is enough to make
 * every back button in the app silently stop working, with the handler running
 * to completion and nothing happening.
 */
function BackButton({
  label,
  href,
  pop,
  tintColor,
}: {
  label: string;
  href: Href;
  pop: boolean;
  tintColor?: string;
}) {
  return (
    <Link
      href={href}
      // Only reached when there is no history: this replaces the dead-end entry
      // rather than stacking another one behind it.
      replace
      asChild
      onPress={(event) => {
        if (!pop) return;
        // `Link` treats a prevented event as already handled and stays put,
        // which is what we want when there is a screen to pop back to.
        event.preventDefault();
        router.back();
      }}>
      {/*
        `style` is a plain object, not the usual `({ pressed }) => …` callback:
        `asChild` hands this element to a Radix `Slot`, which merges the two
        `style` props by spreading them into one another, and spreading a
        function yields `{}`. That silently dropped the row layout and left the
        chevron stacked on top of its label. The pressed state moves to the
        inner view instead, where nothing merges it away.
      */}
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={label === 'Back' ? 'Go back' : `${label}, back`}
        hitSlop={Spacing.sm}
        style={styles.backButton}>
        {({ pressed }) => (
          <View style={[styles.backButtonRow, { opacity: pressed ? 0.4 : 1 }]}>
            <Icon name="chevron.left" size={22} color={tintColor} />
            <Text variant="body" style={tintColor ? { color: tintColor } : undefined}>
              {label}
            </Text>
          </View>
        )}
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  backButton: {
    justifyContent: 'center',
    // The full 44 rather than the usual "draw smaller, make it up with
    // hitSlop": react-native-web drops `hitSlop` entirely, so on the browser
    // preview the drawn box is the whole target.
    minHeight: HIT_TARGET,
    paddingRight: Spacing.sm,
  },
  backButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
  },
});
