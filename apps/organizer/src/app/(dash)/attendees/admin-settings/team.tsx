'use client';

import { useActionState } from 'react';
import type { TeamRole } from '@kgc/shared';
import { CheckboxField, Field, FieldSet, FormActions, FormBanner, FormGrid, SubmitButton } from '../../form';
import {
  inviteMemberAction,
  resendInviteAction,
  removeMemberAction,
  setRolesAction,
  type TeamState,
} from './actions';

export interface RoleOption {
  role: TeamRole;
  label: string;
  covers: string;
}

function RoleBoxes({ options, held = [] }: { options: RoleOption[]; held?: TeamRole[] }) {
  return (
    <FieldSet legend="Roles">
      {options.map((o) => (
        <CheckboxField
          key={o.role}
          name="roles"
          value={o.role}
          label={o.label}
          description={o.covers}
          defaultChecked={held.includes(o.role)}
        />
      ))}
    </FieldSet>
  );
}

export function InviteForm({ options }: { options: RoleOption[] }) {
  const [state, action] = useActionState<TeamState, FormData>(inviteMemberAction, {});
  return (
    /*
     * Keyed on the attempt number, so the fields remount after every submit and
     * take whatever the action handed back: the address and name again when the
     * invitation was refused, nothing at all when it went through.
     *
     * React resets a form once its action has run, so without this a refused
     * invitation emptied both boxes — and the commonest refusal is "pick at
     * least one role", which is one tick away from being right.
     */
    <form action={action} key={`invite-${state.attempt ?? 0}`}>
      <FormBanner state={state} style={{ marginBottom: 12 }} />
      <FormGrid>
        <Field
          name="email"
          type="email"
          label="Email"
          required
          autoComplete="off"
          maxLength={254}
          defaultValue={state.typed?.email ?? ''}
        />
        <Field
          name="name"
          label="Name"
          autoComplete="off"
          maxLength={120}
          defaultValue={state.typed?.name ?? ''}
        />
      </FormGrid>
      <RoleBoxes options={options} held={state.typed?.roles ?? []} />
      <FormActions>
        <SubmitButton pendingLabel="Inviting…">Invite</SubmitButton>
      </FormActions>
    </form>
  );
}

const panel = {
  background: 'var(--surface-alt)',
  border: '1px solid var(--hairline)',
  borderRadius: 4,
  marginTop: 8,
  maxWidth: '100%',
  padding: 12,
  width: 320,
} as const;

/** One row's three actions. Each is its own form, so one cannot submit another. */
export function MemberActions({
  memberId,
  email,
  held,
  options,
}: {
  memberId: string;
  email: string;
  held: TeamRole[];
  options: RoleOption[];
}) {
  const [roles, rolesAction] = useActionState<TeamState, FormData>(setRolesAction, {});
  const [resent, resendAction] = useActionState<TeamState, FormData>(resendInviteAction, {});
  const [removed, removeAction] = useActionState<TeamState, FormData>(removeMemberAction, {});

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <details>
        <summary className="linkish" style={{ cursor: 'pointer', listStyle: 'none' }}>
          Change roles
        </summary>
        <form action={rolesAction} style={panel}>
          <input type="hidden" name="memberId" value={memberId} />
          <FormBanner state={roles} style={{ marginBottom: 12 }} />
          <RoleBoxes options={options} held={held} />
          <SubmitButton small>Save roles</SubmitButton>
        </form>
      </details>

      <details>
        <summary className="linkish" style={{ cursor: 'pointer', listStyle: 'none' }}>
          Resend invitation
        </summary>
        <form action={resendAction} style={panel}>
          <input type="hidden" name="memberId" value={memberId} />
          <FormBanner state={resent} style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 10 }}>
            Emails {email} again with the address to sign in at.
          </div>
          <SubmitButton small pendingLabel="Sending…">
            Send it again
          </SubmitButton>
        </form>
      </details>

      <details>
        <summary
          className="linkish"
          style={{ color: 'var(--danger)', cursor: 'pointer', listStyle: 'none' }}
        >
          Remove
        </summary>
        <form action={removeAction} style={panel}>
          <input type="hidden" name="memberId" value={memberId} />
          <FormBanner state={removed} style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 10 }}>
            {email} is signed out at once and can no longer sign in.
          </div>
          <SubmitButton small variant="danger" pendingLabel="Removing…">
            Remove {email}
          </SubmitButton>
        </form>
      </details>
    </div>
  );
}
