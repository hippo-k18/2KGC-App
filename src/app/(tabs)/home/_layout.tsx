import { router, Stack } from 'expo-router';
import { Pressable } from 'react-native';

import { Text } from '@/components/text';
import { useDemoAuth } from '@/lib/auth/demo-auth';

/**
 * Home tab. The sign-out control lives in this header because every tab body
 * is currently blank — without it there is no way back to the login screen.
 */
export default function HomeLayout() {
  const { signOut } = useDemoAuth();

  async function handleSignOut() {
    await signOut();
    router.replace('/login');
  }

  return (
    <Stack screenOptions={{ headerLargeTitle: true }}>
      <Stack.Screen
        name="index"
        options={{
          title: 'Home',
          headerRight: () => (
            <Pressable onPress={handleSignOut} hitSlop={12}>
              <Text tone="tint" variant="heading">
                Sign out
              </Text>
            </Pressable>
          ),
        }}
      />
    </Stack>
  );
}
