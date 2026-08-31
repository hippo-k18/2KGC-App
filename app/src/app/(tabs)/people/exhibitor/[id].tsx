import { Linking, Pressable, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { DataError } from '@/components/data-error';
import { EmptyState } from '@/components/empty-state';
import { PushedHeader } from '@/components/pushed-header';
import { Screen } from '@/components/screen';
import { SkeletonBlock, SkeletonScreen } from '@/components/skeleton';
import { SponsorLogo } from '@/components/sponsor-logo';
import { Text } from '@/components/text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useExhibitor } from '@/lib/data/exhibitors';

const LOGO = 88;
const BUTTON_HEIGHT = 50;

/**
 * An exhibitor's card, built from the same pieces as the sponsor one.
 *
 * ## What is deliberately not here, and why it cannot be
 *
 * **A contact.** `ExhibitorDoc` carries `contactName` and `contactEmail` and
 * this screen cannot show them, because it is not reading that document —
 * `exhibitorListings/{id}` is a projection that never had them. That is the
 * point rather than a limitation: a readable exhibitor list carrying named
 * individuals' addresses is a harvestable one, and Firestore rules filter
 * documents rather than fields, so there was no third option.
 *
 * **A stand on the floor plan.** The booth *number* is here; `booths/{number}`
 * is not readable by any client and does not need to be, since it holds an order
 * id, a ticket type and a `held`-but-unpaid state alongside the geometry. A map
 * needs the venue's plans, which the Floormap tile already says do not exist.
 *
 * **"Request information" / lead capture.** `sponsors/{id}/leads` has a rule and
 * an exhibitor equivalent has neither a rule nor a way for the exhibitor to read
 * what it collected. A button that silently wrote nothing would be worse than
 * its absence — the same call `sponsor/[id].tsx` makes.
 */
export default function ExhibitorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useTheme();
  const { exhibitor, error, status, retry } = useExhibitor(id);

  const header = <PushedHeader backTitle="People" backHref="/people" />;
  const missing = status === 'ready' && !exhibitor;

  if (error) {
    return (
      <>
        {header}
        <Screen grouped>
          <DataError error={error} subject="this exhibitor" onRetry={retry} />
        </Screen>
      </>
    );
  }

  if (missing) {
    return (
      <>
        {header}
        <Screen grouped>
          <EmptyState
            icon="storefront"
            title="Exhibitor not found"
            message="This exhibitor is no longer in the hall."
          />
        </Screen>
      </>
    );
  }

  if (!exhibitor) {
    return (
      <>
        {header}
        <Screen grouped>
          <SkeletonScreen
            label="this exhibitor"
            slowNotice="Still loading. The app cannot reach the server — this will fill in as soon as it can.">
            <View style={{ alignItems: 'center', gap: Spacing.sm, paddingTop: Spacing.sm }}>
              <SkeletonBlock width={LOGO} height={LOGO} radius={Radius.pill} />
              <SkeletonBlock width="45%" height={22} />
              <SkeletonBlock width="30%" height={16} />
            </View>
            <SkeletonBlock height={BUTTON_HEIGHT} radius={Radius.md} />
            <SkeletonBlock height={70} radius={Radius.md} />
          </SkeletonScreen>
        </Screen>
      </>
    );
  }

  return (
    <>
      {header}
      <Screen grouped>
        <View style={{ alignItems: 'center', gap: Spacing.sm, paddingTop: Spacing.sm }}>
          <SponsorLogo name={exhibitor.name} logoURL={exhibitor.logoURL} size={LOGO} />
          <Text variant="title3">{exhibitor.name}</Text>
          {exhibitor.boothNumber ? (
            <Text tone="secondary">Booth {exhibitor.boothNumber}</Text>
          ) : null}
        </View>

        {exhibitor.website ? (
          <Pressable
            onPress={() => Linking.openURL(exhibitor.website!)}
            accessibilityRole="link"
            accessibilityLabel={`Open ${exhibitor.name}'s website`}
            style={({ pressed }) => ({
              backgroundColor: colors.accent,
              opacity: pressed ? 0.85 : 1,
              borderRadius: Radius.md,
              height: BUTTON_HEIGHT,
              alignItems: 'center',
              justifyContent: 'center',
            })}>
            <Text variant="heading" tone="onAccent">
              Visit website
            </Text>
          </Pressable>
        ) : null}

        {exhibitor.description ? (
          <View style={{ gap: Spacing.sm }}>
            <Text variant="label" tone="secondary">
              ABOUT
            </Text>
            <Text>{exhibitor.description}</Text>
          </View>
        ) : null}
      </Screen>
    </>
  );
}
