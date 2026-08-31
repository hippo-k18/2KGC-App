'use client';

import { useActionState, useId, useState } from 'react';
import { Field, FormActions, FormBanner, SubmitButton, Textarea } from '../../../form';
import { saveTrackAction, type TrackState } from './actions';

export interface EditableTrack {
  id: string;
  name: string;
  color?: string;
  description?: string;
  /** Sessions cross-listed into this track. */
  sessionCount: number;
  /** Of those, the ones whose agenda card actually displays it. */
  primaryCount: number;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** What the seed already uses, so a new track looks like it belongs. */
const PALETTE = ['#2180b2', '#0f766e', '#7c3aed', '#b45309', '#be123c', '#0369a1', '#4d7c0f'];

/**
 * Create or edit one track.
 *
 * ── The colour is data, so it gets a picker and a text box ──────────────────
 *
 * `TrackDoc.color` is a stored hex string that the app and the website render
 * on every agenda card, not a theme token — so it cannot come from the
 * stylesheet, and a text field alone makes an organizer type six hex digits
 * they will get wrong. The two controls are the same value: the picker writes
 * into the text box, and the text box is what is submitted. Blank is a real
 * answer meaning "no colour", which is why the picker cannot be the only
 * control — a native colour input has no empty state.
 *
 * The swatches are the palette the seed already uses, offered rather than
 * enforced: eleven tracks that all chose their own blue is the failure this
 * prevents, and a programme chair who wants their own colour still can.
 */
export function TrackForm({ existing }: { existing?: EditableTrack }) {
  const [state, action] = useActionState<TrackState, FormData>(saveTrackAction, {});
  const [color, setColor] = useState(existing?.color ?? '');
  const pickerId = useId();

  return (
    <form action={action}>
      {existing && <input type="hidden" name="id" value={existing.id} />}

      <FormBanner state={state} />

      {state.fanOut && (
        <p
          className={state.fanOutOk ? 'muted' : undefined}
          role={state.fanOutOk ? undefined : 'alert'}
          style={{
            fontSize: 13,
            marginTop: -8,
            ...(state.fanOutOk ? null : { color: 'var(--danger)', fontWeight: 600 }),
          }}
        >
          Agenda caches: {state.fanOut}
          {state.fanOutOk ? null : ' Use “Repair” below to rebuild them.'}
        </p>
      )}

      <Field
        name="name"
        label="Track"
        required
        defaultValue={existing?.name}
        error={state.fieldErrors?.name}
        maxLength={60}
        width="lg"
        hint={
          existing ? (
            <>
              {existing.sessionCount} session{existing.sessionCount === 1 ? '' : 's'} carry this
              track,{' '}
              {existing.primaryCount === 0
                ? 'none of which display it'
                : `${existing.primaryCount} of which display it on the agenda card`}
              . A rename rewrites those cards. Id <code>{existing.id}</code> never changes —
              sessions point at it.
            </>
          ) : (
            'The filter chip an attendee taps in the app. Short enough to read on a phone.'
          )
        }
      />

      <Field
        name="color"
        label="Colour"
        value={color}
        onChange={(e) => setColor(e.target.value)}
        error={state.fieldErrors?.color}
        placeholder="#2180b2"
        width="sm"
        autoComplete="off"
        hint="Six hex digits, or blank for no colour. Shown as the stripe on every agenda card in this track."
      />

      <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: -8 }}>
        <label htmlFor={pickerId} className="muted" style={{ fontSize: 12 }}>
          Pick
        </label>
        <input
          id={pickerId}
          type="color"
          value={HEX.test(color) ? color : PALETTE[0]}
          onChange={(e) => setColor(e.target.value)}
          style={{ blockSize: 28, border: '1px solid var(--hairline)', inlineSize: 40, padding: 0 }}
        />
        {PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            aria-label={`Use ${c}`}
            style={{
              background: c,
              border: color.toLowerCase() === c ? '2px solid var(--ink)' : '1px solid var(--hairline)',
              borderRadius: 3,
              cursor: 'pointer',
              height: 20,
              padding: 0,
              width: 20,
            }}
          />
        ))}
        {color ? (
          <button type="button" className="linkish" style={{ fontSize: 12 }} onClick={() => setColor('')}>
            Clear
          </button>
        ) : null}
      </div>

      <Textarea
        name="description"
        label="Description"
        rows={3}
        defaultValue={existing?.description}
        hint="Organizer-facing. Nothing in the app or on the website renders it yet — it is here so a programme committee can record what belongs in the track."
      />

      <FormActions>
        <SubmitButton pendingLabel="Saving…">
          {existing ? 'Save changes' : 'Add track'}
        </SubmitButton>
      </FormActions>
    </form>
  );
}
