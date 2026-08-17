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
      [role='tablist'][aria-label='Main'] {
        max-width: calc(100vw - 16px);
      }
      [role='tablist'][aria-label='Main'] > button {
        min-width: 0;
        flex-shrink: 1;
      }
      [role='tablist'][aria-label='Main'] > button > span {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      @media (max-width: 520px) {
        [role='tablist'][aria-label='Main'] > button {
          padding: 0 5px;
        }
      }
    `;
    document.head.appendChild(style);
  }
}

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
    <NativeTabs tintColor={colors.tint} backgroundColor={colors.surface}>
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
