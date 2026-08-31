import { View } from 'react-native';

import { DataError } from '@/components/data-error';
import { EmptyState } from '@/components/empty-state';
import { ListRow } from '@/components/list-row';
import { PushedHeader } from '@/components/pushed-header';
import { Screen } from '@/components/screen';
import { SectionCard } from '@/components/section-card';
import { SkeletonBlock, SkeletonScreen } from '@/components/skeleton';
import { Text } from '@/components/text';
import { Radius, Spacing } from '@/constants/theme';
import { useLogistics } from '@/lib/data/logistics';

/**
 * The emergency card.
 *
 * `settings/logistics` is written weekly by the dashboard's Emergency Manager
 * and, until now, read by nobody outside the organizing team. This is the one
 * settings bag where that gap had a cost: the assembly point and the venue
 * security number exist for somebody standing in the building, and the
 * organizer's screen is not where that person is looking.
 *
 * The Home tile that opens this used to say the data lived "on an event
 * document that does not exist yet — there is no events collection to read it
 * from". That was true when it was written and had stopped being true months
 * before it was read; correcting it is half of what this screen is for, the same
 * stale-gap-copy defect the Surveys tile beside it already had fixed.
 *
 * ## `planReady` is a gate, not a hint
 *
 * A half-filled emergency card during an emergency is worse than none: somebody
 * walks to an assembly point that was a placeholder. The organizer's own
 * assertion that the card is fit to show is a stored field, the dashboard
 * refuses to set it with neither an assembly point nor a lead, and this screen
 * refuses to render the card without it. What it shows instead says plainly
 * that the plan is not published — not "nothing here", which reads as a bug.
 *
 * ## Blank fields are omitted rather than shown empty
 *
 * `LogisticsSettings` is free text throughout and most events fill in three of
 * the seven. A row reading "Medical point —" is a row that has to be read and
 * discounted, and there is no worse moment to make somebody do that.
 */
export default function LogisticsScreen() {
  const { logistics, planReady, error, status, retry } = useLogistics();

  if (error) {
    return (
      <>
        <PushedHeader backTitle="Home" backHref="/home" />
        <Screen grouped>
          <DataError error={error} subject="the emergency information" onRetry={retry} />
        </Screen>
      </>
    );
  }

  if (status === 'loading') {
    return (
      <>
        <PushedHeader backTitle="Home" backHref="/home" />
        <Screen grouped>
          <SkeletonScreen
            label="the emergency information"
            slowNotice="Still loading. The app cannot reach the server — this will fill in as soon as it can.">
            <SkeletonBlock height={64} radius={Radius.lg} />
            <SkeletonBlock height={64} radius={Radius.lg} />
          </SkeletonScreen>
        </Screen>
      </>
    );
  }

  if (!logistics || !planReady) {
    return (
      <>
        <PushedHeader backTitle="Home" backHref="/home" />
        <Screen grouped contentStyle={{ flexGrow: 1 }}>
          <EmptyState
            icon="exclamationmark.triangle"
            title="No emergency plan published"
            message={
              'The organizers have not marked this event’s emergency information as ready ' +
              'to publish. In an emergency, follow the instructions of venue staff.'
            }
          />
        </Screen>
      </>
    );
  }

  // Label, value, and an optional second line. Built as a list so the omission
  // of a blank field is one condition in one place rather than a conditional per
  // row in the markup.
  const rows: { label: string; value: string; meta?: string }[] = [
    { label: 'Emergency services', value: logistics.emergencyNumber },
    { label: 'Venue security', value: logistics.venueSecurity },
    { label: 'Medical point', value: logistics.medicalPoint },
    { label: 'Assembly point', value: logistics.assemblyPoint },
    {
      label: 'On-site lead',
      value: logistics.onSiteLead,
      meta: logistics.onSiteLeadPhone.trim() || undefined,
    },
  ].filter((r) => r.value.trim().length > 0);

  const procedure = logistics.incidentProcedure.trim();

  return (
    <>
      <PushedHeader backTitle="Home" backHref="/home" />
      <Screen grouped contentStyle={{ gap: Spacing.lg }}>
        <Text variant="subhead" tone="secondary">
          Published by the organizers for KGC 2027. Save the numbers you would need
          before you need them.
        </Text>

        {rows.length ? (
          <View>
            {rows.map((r, i) => (
              <ListRow
                key={r.label}
                title={r.label}
                subtitle={r.value}
                meta={r.meta}
                first={i === 0}
                last={i === rows.length - 1}
              />
            ))}
          </View>
        ) : null}

        {procedure ? (
          <SectionCard title="If something happens">
            <Text variant="body">{procedure}</Text>
          </SectionCard>
        ) : null}
      </Screen>
    </>
  );
}
