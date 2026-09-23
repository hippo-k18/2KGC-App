'use client';

import { useActionState } from 'react';
import {
  FieldIdScope,
  FormActions,
  FormBanner,
  Select,
  SubmitButton,
  Textarea,
  type FormState,
} from '../../../form';
import { revokeLeadLinkAction, sendLeadLinkAction } from './actions';

/**
 * Sending and stopping a stand's lead desk link.
 *
 * The same pair the speaker portal has, and the same shape for the same reason:
 * `useActionState`, so the outcome is a banner on the panel that was pressed
 * rather than a redirect that loses which of two forms it belonged to. They are
 * apart from the page because they hold form state and `ui.tsx` may not be
 * imported by a client component.
 */

export interface LeadLinkTarget {
  id: string;
  name: string;
  hasAddress: boolean;
  cancelled: boolean;
  /** "Sent 12 Mar", "Stopped", "Not sent". Always something. */
  statusLabel: string;
}

/**
 * Send one stand the link their staff scan with.
 *
 * No "send to everybody" option, unlike the speaker version. A speaker chase is
 * a list of forty-five people who all need the same nudge; a booth link goes
 * out when a stand is confirmed and when somebody on it asks for it again, one
 * at a time, and a button that mails six companies at once is a button somebody
 * presses twice.
 */
export function SendLeadLinkForm({
  exhibitors,
  emailOn,
}: {
  exhibitors: LeadLinkTarget[];
  emailOn: boolean;
}) {
  const [state, action] = useActionState<FormState, FormData>(sendLeadLinkAction, {});
  const reachable = exhibitors.filter((e) => e.hasAddress && !e.cancelled);

  return (
    <FieldIdScope scope="send-lead-link">
      <form action={action}>
        <FormBanner state={state} />
        <Select
          label="Send to"
          name="exhibitorId"
          required
          placeholder="Choose a stand…"
          width="xl"
          options={exhibitors.map((e) => ({
            value: e.id,
            label: e.cancelled
              ? `${e.name} · cancelled`
              : e.hasAddress
                ? `${e.name} · ${e.statusLabel}`
                : `${e.name} · no address on file`,
            // Greyed out with the reason in the row, never greyed out silently:
            // "why can I not email Graphwise?" has to be answerable from here.
            disabled: !e.hasAddress || e.cancelled,
          }))}
        />
        <Textarea
          label="A note from you"
          name="note"
          rows={3}
          maxLength={2000}
          placeholder="Optional. Shown above the button, for example which hall entrance to collect badges from."
        />
        <FormActions>
          <SubmitButton pendingLabel="Sending…">Send link</SubmitButton>
        </FormActions>
        {reachable.length === 0 && (
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            No stand has a contact address on file yet, so there is nowhere to send to. Add one on
            the exhibitor&rsquo;s record first.
          </p>
        )}
        {!emailOn && (
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            Email is not switched on yet, so pressing this sends nothing. Copy the link from the row
            and send it yourself until it is.
          </p>
        )}
      </form>
    </FieldIdScope>
  );
}

/**
 * Stop every link one stand holds.
 *
 * Its own form rather than a row action, because it cannot be undone from their
 * side: their page stops opening with no message to them, their spreadsheet
 * download stops with it, and the only way back is an organizer sending a new
 * link. What it does not touch is the leads themselves — those are a record of
 * people who agreed, and the panel says so.
 */
export function RevokeLeadLinkForm({ exhibitors }: { exhibitors: LeadLinkTarget[] }) {
  const [state, action] = useActionState<FormState, FormData>(revokeLeadLinkAction, {});

  return (
    <FieldIdScope scope="revoke-lead-link">
      <form action={action}>
        <FormBanner state={state} />
        <Select
          label="Stop a link"
          name="exhibitorId"
          required
          placeholder="Choose a stand…"
          width="xl"
          options={exhibitors.map((e) => ({
            value: e.id,
            label: `${e.name} · ${e.statusLabel}`,
          }))}
        />
        <FormActions>
          <SubmitButton variant="danger" pendingLabel="Stopping…">
            Stop this stand&rsquo;s links
          </SubmitButton>
        </FormActions>
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          Every link already sent to them stops opening, including the spreadsheet download. They
          are not told. The leads they have already taken are kept. Send a new link to let them back
          in.
        </p>
      </form>
    </FieldIdScope>
  );
}
