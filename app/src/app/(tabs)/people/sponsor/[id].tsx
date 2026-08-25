import { Linking, Pressable, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { doc } from 'firebase/firestore';

import { COLLECTIONS, type SponsorDoc, type WithId } from '@kgc/shared';

import { SponsorLogo } from '@/components/sponsor-logo';
import { DataError } from '@/components/data-error';
import { EmptyState } from '@/components/empty-state';
import { PushedHeader } from '@/components/pushed-header';
import { Screen } from '@/components/screen';
import { SkeletonBlock, SkeletonScreen } from '@/components/skeleton';
import { Text } from '@/components/text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDocument } from '@/lib/data/use-document';
import { getDb } from '@/lib/firebase/client';

type Entry = WithId<SponsorDoc>;

const LOGO = 88;
const BUTTON_HEIGHT = 50;

/**
 * A sponsor's card.
 *
 * The People tab's Sponsors segment passed no `onPress` at all, so all fifteen
 * rows were inert — and each of those documents carries a description, a booth
 * location and a website that nothing in the app could reach. Sponsors are the
 * people paying for the conference; a tier badge in a list they cannot be opened
 * from is not what they bought.
 *
 * ## What is deliberately not here
 *
 * **"Request information" / lead capture.** `sponsors/{id}/leads` is modelled
 * and it is the feature sponsors actually want, but a write to it needs a rule
 * that does not exist yet and a way for the sponsor to read their own leads,
 * which is console work. A button that silently wrote nothing would be worse
 * than its absence.
 *
 * **Offers and downloads.** Both are on `SponsorDoc` and both are empty in every
 * seeded document, so they render only when there is something to render rather
 * than as two permanently empty headings.
 */
export default function SponsorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useTheme();

  const {
    data: sponsor,
    status,
    error,
    retry,
  } = useDocument<Entry>(
    () => (id ? doc(getDb(), COLLECTIONS.sponsors, id) : null),
    [id],
    (docId, d) => ({ id: docId, ...d }) as Entry,
  );

  const missing = status === 'ready' && !sponsor;
  const header = <PushedHeader backTitle="People" backHref="/people" />;

  if (error) {
    return (
      <>
        {header}
        <Screen grouped>
          <DataError error={error} subject="this sponsor" onRetry={retry} />
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
            title="Sponsor not found"
            message="This sponsor is no longer listed."
          />
        </Screen>
      </>
    );
  }
  if (!sponsor) {
    return (
      <>
        {header}
        <Screen grouped>
          <SkeletonScreen
            label="this sponsor"
            slowNotice="Still loading. The app cannot reach the server — this will fill in as soon as it can.">
            <View style={{ alignItems: 'center', gap: Spacing.sm, paddingTop: Spacing.sm }}>
              <SkeletonBlock width={LOGO} height={LOGO} radius={Radius.pill} />
              <SkeletonBlock width="45%" height={22} />
              <SkeletonBlock width="35%" height={16} />
            </View>
            <SkeletonBlock height={BUTTON_HEIGHT} radius={Radius.md} />
            <SkeletonBlock height={70} radius={Radius.md} />
          </SkeletonScreen>
        </Screen>
      </>
    );
  }

  const tier = sponsor.tier[0].toUpperCase() + sponsor.tier.slice(1);

  return (
    <>
      {header}
      <Screen grouped>
        <View style={{ alignItems: 'center', gap: Spacing.sm, paddingTop: Spacing.sm }}>
          <SponsorLogo name={sponsor.name} logoURL={sponsor.logoURL} size={LOGO} />
          <Text variant="title3">{sponsor.name}</Text>
          <Text tone="secondary" style={{ textAlign: 'center' }}>
            {[`${tier} sponsor`, sponsor.boothLocation ? `Booth ${sponsor.boothLocation}` : null]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>

        {sponsor.website ? (
          <Pressable
            onPress={() => Linking.openURL(sponsor.website!)}
            accessibilityRole="link"
            accessibilityLabel={`Open ${sponsor.name}'s website`}
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

        {sponsor.description ? (
          <View style={{ gap: Spacing.sm }}>
            <Text variant="label" tone="secondary">
              ABOUT
            </Text>
            <Text>{sponsor.description}</Text>
          </View>
        ) : null}

        {sponsor.offers?.length ? (
          <View style={{ gap: Spacing.sm }}>
            <Text variant="label" tone="secondary">
              AT THE BOOTH
            </Text>
            {sponsor.offers.map((o) => (
              <Text key={o}>{o}</Text>
            ))}
          </View>
        ) : null}
      </Screen>
    </>
  );
}
