import { Icon, Label, NativeTabs } from 'expo-router/unstable-native-tabs';

import { Colors } from '@/constants/theme';
import { useScheme } from '@/hooks/use-theme';

/**
 * Native iOS tab bar, laid out to match Whova: Home, Agenda, Attendees,
 * Community, Messages. `NativeTabs` renders a real UITabBar rather than a
 * JavaScript imitation, so it inherits system behaviour and appearance.
 *
 * `sf` names are SF Symbols; browse them in Apple's free SF Symbols app. The
 * type is a strict union, so an invalid name is a compile error rather than a
 * blank icon.
 *
 * To add an unread badge to a tab, drop a `<Badge>` inside its Trigger and
 * import it alongside Icon and Label.
 */
export default function TabLayout() {
  const colors = Colors[useScheme()];

  return (
    <NativeTabs tintColor={colors.tint} backgroundColor={colors.surface}>
      <NativeTabs.Trigger name="home">
        <Icon sf={{ default: 'house', selected: 'house.fill' }} />
        <Label>Home</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="agenda">
        <Icon sf="calendar" />
        <Label>Agenda</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="attendees">
        <Icon sf={{ default: 'person.2', selected: 'person.2.fill' }} />
        <Label>Attendees</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="community">
        <Icon
          sf={{
            default: 'bubble.left.and.bubble.right',
            selected: 'bubble.left.and.bubble.right.fill',
          }}
        />
        <Label>Community</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="messages">
        <Icon sf={{ default: 'envelope', selected: 'envelope.fill' }} />
        <Label>Messages</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
