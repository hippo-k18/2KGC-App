import { Redirect } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Platform } from 'react-native';
import {
  Icon,
  Label,
  NativeTabs,
  VectorIcon,
} from 'expo-router/unstable-native-tabs';

import { Colors } from '@/constants/theme';
import { useScheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth/auth-provider';

/**
 * Make the browser preview's tab bar fit a phone.
 *
 * On iOS and Android `NativeTabs` is a real UITabBar / Material bottom
 * navigation, and both lay five items out across whatever width they are given.
 * On web it is a Radix tab list styled by expo-router's own stylesheet
 * (`expo-router/assets/native-tabs.module.css`), and that stylesheet is written
 * for a desktop window: `max-width: 90vw`, 20px of padding either side of every
 * label, `white-space: nowrap`, the whole pill `position: fixed` at the top.
 *
 * Five labels need 445px. At 393px — the logical width of an iPhone 15, and the
 * most common phone width there is — 90vw gives the pill 354px, so 91px of it is
 * past its own right edge: "Community" is clipped mid-word and "Me" is not drawn
 * at all. The pill is `overflow-x: auto`, so the content is technically
 * scrollable, but a fixed 40px bar with no scrollbar and no gradient gives no
 * hint of that — the Me tab simply could not be opened in the preview. At 320px
 * (iPhone SE) 157px is missing and "Community" goes with it.
 *
 * The fix is three rules: a slightly wider ceiling than 90vw, a phone-sized
 * gutter instead of a desktop one, and permission for a label to shrink and
 * ellipsize rather than demand its full width — the last so that this cannot
 * silently break again if a tab is renamed or a sixth one is added. The scroll
 * container is deliberately left in place as the final backstop.
 *
 * It is CSS because the rules it has to outrank are CSS in a package we do not
 * control; an attribute selector already beats their single class, so nothing
 * here needs `!important`. And it is inert on device: the block is behind
 * `Platform.OS === 'web'`, and the bar it targets is not the one either platform
 * draws. `typeof document` covers the static render, which runs in Node.
 */
const WEB_TAB_BAR_STYLE_ID = 'kgc-web-tab-bar';

if (Platform.OS === 'web' && typeof document !== 'undefined') {
  if (!document.getElementById(WEB_TAB_BAR_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = WEB_TAB_BAR_STYLE_ID;
    style.textContent = `
      /*
       * Rebuild the web tab bar as the bar the device actually draws.
       *
       * Two things were wrong with the preview, and both mislead anyone judging
       * the app from it — or from a recording of it.
       *
       * First, position. expo-router's web stylesheet pins the tab list to
       * "top: 24px"; iOS and Android both draw it along the bottom. "top: auto"
       * is required as well as "bottom", or both edges pin and the bar stretches
       * down the whole screen.
       *
       * Second, and worse: **the web build renders no icons at all.** The
       * "<Icon sf=… androidSrc=… />" children are read by the native tab bars and
       * dropped by "NativeTabsView.web", which emits a Radix tab list of bare
       * text labels in a floating pill. That is not a small cosmetic gap; it is a
       * different control. The icons below are the same Material glyphs the
       * Android bar uses, applied as masks so a single rule can recolour them for
       * the selected state.
       *
       * All of this is web-only and inert on device — it is behind
       * "Platform.OS === 'web'", and the bar it targets is not the one either
       * platform draws. Their rules are single classes, so these attribute pairs
       * outrank them without "!important".
       */
      [role='tablist'][aria-label='Main'] {
        top: auto;
        bottom: 0;
        left: 0;
        right: 0;
        transform: none;
        width: 100%;
        max-width: 100%;
        height: auto;
        border-radius: 0;
        background: rgba(255, 255, 255, 0.94);
        -webkit-backdrop-filter: saturate(180%) blur(20px);
        backdrop-filter: saturate(180%) blur(20px);
        border-top: 0.5px solid rgba(0, 0, 0, 0.18);
        box-shadow: none;
        display: flex;
        gap: 0;
        padding: 7px 0 calc(7px + env(safe-area-inset-bottom, 0px));
        overflow: visible;
      }

      [role='tablist'][aria-label='Main'] > button {
        flex: 1 1 0;
        min-width: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-end;
        gap: 3px;
        height: auto;
        padding: 0 2px;
        background: none;
        border-radius: 0;
        color: #8e8e93;
      }

      /* The glyph the web build never renders. */
      [role='tablist'][aria-label='Main'] > button::before {
        content: '';
        width: 25px;
        height: 25px;
        background-color: currentColor;
        -webkit-mask-repeat: no-repeat;
                mask-repeat: no-repeat;
        -webkit-mask-position: center;
                mask-position: center;
        -webkit-mask-size: contain;
                mask-size: contain;
      }

      [role='tablist'][aria-label='Main'] > button > span {
        display: block;
        font-size: 10px;
        line-height: 12px;
        letter-spacing: 0.01em;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 100%;
      }

      [role='tablist'][aria-label='Main'] > button[aria-selected='true'] {
        color: #1d5fbf;
      }

      /* The pill highlight the web build draws behind the active tab. */
      [role='tablist'][aria-label='Main'] > button[aria-selected='true']::after {
        display: none;
      }

      [role='tablist'][aria-label='Main'] > button:nth-child(1)::before {
        -webkit-mask-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z'/></svg>");
                mask-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z'/></svg>");
      }
      [role='tablist'][aria-label='Main'] > button:nth-child(2)::before {
        -webkit-mask-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19a2 2 0 002 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z'/></svg>");
                mask-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19a2 2 0 002 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z'/></svg>");
      }
      [role='tablist'][aria-label='Main'] > button:nth-child(3)::before {
        -webkit-mask-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z'/></svg>");
                mask-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z'/></svg>");
      }
      [role='tablist'][aria-label='Main'] > button:nth-child(4)::before {
        -webkit-mask-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M21 6h-2v9H6v2c0 .55.45 1 1 1h11l4 4V7c0-.55-.45-1-1-1zm-4 6V3c0-.55-.45-1-1-1H3c-.55 0-1 .45-1 1v14l4-4h10c.55 0 1-.45 1-1z'/></svg>");
                mask-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M21 6h-2v9H6v2c0 .55.45 1 1 1h11l4 4V7c0-.55-.45-1-1-1zm-4 6V3c0-.55-.45-1-1-1H3c-.55 0-1 .45-1 1v14l4-4h10c.55 0 1-.45 1-1z'/></svg>");
      }
      [role='tablist'][aria-label='Main'] > button:nth-child(5)::before {
        -webkit-mask-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/></svg>");
                mask-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/></svg>");
      }
    `;
    document.head.appendChild(style);
  }
}

/**
 * Tab-bar appearance, iOS and Android only.
 *
 * On iOS 26 `NativeTabs` renders the new floating capsule, which is why a
 * side-by-side against Whova reads as "the nav bar is not the same and too big":
 * Whova draws a classic full-width UITabBar with a hairline above it, and ours
 * draws a translucent pill with a large rounded highlight behind the selected
 * tab. The pill's *shape* belongs to the OS and cannot be turned off from here.
 * What can be set is everything that makes it look heavier than it needs to:
 * `blurEffect: 'none'` and `disableTransparentOnScrollEdge` stop content showing
 * through it, `minimizeBehavior: 'never'` keeps it from resizing as the page
 * scrolls, and a 10pt label matches Whova's caption-sized ones.
 *
 * **Spread empty on web, and that is not a tidiness point.** The web build
 * renders a Radix tab list from `NativeTabsView.web`, which reads `labelStyle`
 * and ignores the rest — and passing them anyway took the whole preview down to
 * a blank root div that never recovered. These describe a UITabBar; there is no
 * UITabBar on web.
 */
const TAB_BAR_APPEARANCE =
  Platform.OS === 'web'
    ? {}
    : ({
        blurEffect: 'none',
        minimizeBehavior: 'never',
        disableTransparentOnScrollEdge: true,
        labelStyle: { fontSize: 10 },
      } as const);

/**
 * Native tab bar: Home, Agenda, People, Community, Me.
 *
 * Deliberately NOT Whova's layout, which this originally copied. Whova puts
 * Messages in the bar, where it sits empty for most attendees all week, and
 * splits attendees, speakers and sponsors across places people do not look.
 * Here People carries all three as segments, Messages becomes a header icon
 * with an unread badge, and Me holds the things you need in a hurry — badge QR,
 * wifi, map, privacy. `NativeTabs` renders a real UITabBar on iOS and Material bottom
 * navigation on Android, rather than a JavaScript imitation of either.
 *
 * Each icon is given twice because the platforms use different icon systems:
 *   sf         SF Symbols, iOS only. Typed against a union of valid names,
 *              so a typo is a compile error rather than a blank icon.
 *   androidSrc anything renderable; here a Material icon via VectorIcon.
 *
 * Supplying only `sf` leaves Android with labels and no icons at all.
 */
export default function TabLayout() {
  const colors = Colors[useScheme()];
  const { user, loading } = useAuth();

  /*
   * The gate. Only `/` was guarded before, so signing out left the whole tab
   * shell mounted and browsable: every screen still rendered its chrome, just
   * with no data — Agenda with no days, "All Attendees (0)", "0 topics". That
   * reads as an app that has lost the conference, not as a signed-out state,
   * and browser-back walked straight back into it.
   *
   * It also covers the token expiring mid-conference, which produces exactly
   * the same empty-but-chromed screens.
   */
  if (loading) return null;
  if (!user) return <Redirect href="/login" />;

  return (
    /*
     * Pinned, opaque and small-labelled — as close to Whova's flat bar as the
     * native control allows.
     *
     * On iOS 26 `NativeTabs` renders the new floating capsule, which is why a
     * side-by-side against Whova reads as "the nav bar is not the same and too
     * big": Whova draws a classic full-width UITabBar with a hairline above it,
     * and ours draws a translucent pill with a large rounded highlight behind
     * the selected tab. The pill's *shape* is the OS's and cannot be turned off
     * from here. What can be set is everything that makes it look bulkier than
     * it needs to:
     *
     * - `blurEffect="none"` plus `disableTransparentOnScrollEdge` stops content
     *   showing through it, which is most of the visual weight.
     * - `minimizeBehavior="never"` keeps it from resizing as the page scrolls,
     *   so it is one fixed object rather than two.
     * - `labelStyle` at 10pt matches Whova's caption-sized labels; the default
     *   is the system body size, which is what makes five labels feel crowded.
     */
    <NativeTabs tintColor={colors.tint} backgroundColor={colors.surface} {...TAB_BAR_APPEARANCE}>
      <NativeTabs.Trigger name="home">
        <Icon
          sf={{ default: 'house', selected: 'house.fill' }}
          androidSrc={<VectorIcon family={MaterialIcons} name="home" />}
        />
        <Label>Home</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="agenda">
        <Icon
          sf="calendar"
          androidSrc={<VectorIcon family={MaterialIcons} name="event" />}
        />
        <Label>Agenda</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="people">
        <Icon
          sf={{ default: 'person.2', selected: 'person.2.fill' }}
          androidSrc={<VectorIcon family={MaterialIcons} name="people" />}
        />
        <Label>People</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="community">
        <Icon
          sf={{
            default: 'bubble.left.and.bubble.right',
            selected: 'bubble.left.and.bubble.right.fill',
          }}
          androidSrc={<VectorIcon family={MaterialIcons} name="forum" />}
        />
        <Label>Community</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="me">
        <Icon
          sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }}
          androidSrc={<VectorIcon family={MaterialIcons} name="account-circle" />}
        />
        <Label>Me</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
