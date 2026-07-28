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
 * Native tab bar, laid out to match Whova: Home, Agenda, Attendees, Community,
 * Messages. `NativeTabs` renders a real UITabBar on iOS and Material bottom
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

      <NativeTabs.Trigger name="attendees">
        <Icon
          sf={{ default: 'person.2', selected: 'person.2.fill' }}
          androidSrc={<VectorIcon family={MaterialIcons} name="people" />}
        />
        <Label>Attendees</Label>
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

      <NativeTabs.Trigger name="messages">
        <Icon
          sf={{ default: 'envelope', selected: 'envelope.fill' }}
          androidSrc={<VectorIcon family={MaterialIcons} name="email" />}
        />
        <Label>Messages</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
