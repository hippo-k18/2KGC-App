import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {
  Icon,
  Label,
  NativeTabs,
  VectorIcon,
} from 'expo-router/unstable-native-tabs';

import { Colors } from '@/constants/theme';
import { useScheme } from '@/hooks/use-theme';

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
