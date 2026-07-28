import { Icon, Label, NativeTabs } from 'expo-router/unstable-native-tabs';

import { Colors } from '@/constants/theme';
import { useScheme } from '@/hooks/use-theme';

/**
 * Native iOS tab bar. `NativeTabs` renders a real UITabBar rather than a
 * JavaScript imitation, so it inherits system behaviour and appearance.
 *
 * `sf` names are SF Symbols; browse them in Apple's free SF Symbols app. The
 * type is a strict union, so an invalid name is a compile error rather than a
 * blank icon. Android icons are omitted for now — they need `drawable`
 * resources that only exist once a native Android project is generated.
 */
export default function TabLayout() {
  const colors = Colors[useScheme()];

  return (
    <NativeTabs tintColor={colors.tint} backgroundColor={colors.surface}>
      <NativeTabs.Trigger name="agenda">
        <Icon sf="calendar" />
        <Label>Agenda</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="speakers">
        <Icon sf={{ default: 'person.2', selected: 'person.2.fill' }} />
        <Label>Speakers</Label>
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
        <Icon sf={{ default: 'message', selected: 'message.fill' }} />
        <Label>Messages</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="profile">
        <Icon
          sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }}
        />
        <Label>Profile</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
