'use client';

import { useActionState, useState } from 'react';
import type { SponsorTierDef } from '@kgc/shared';
import { Field, FormBanner, FormGrid, Select, SubmitButton, type FormState } from '../../../form';
import { Table } from '../../../ui';
import { editSponsorTiersAction } from './actions';

/** Set the row form's `op` field to the button that was pressed. */
function setOp(op: string) {
  return (e: React.MouseEvent<HTMLButtonElement>) => {
    const field = e.currentTarget.form?.elements.namedItem('op');
    if (field instanceof HTMLInputElement) field.value = op;
  };
}

const SIZES = [
  { value: '3', label: 'Large' },
  { value: '2', label: 'Medium' },
  { value: '1', label: 'Small' },
];

/**
 * The tier list, editable in place.
 *
 * One `<form>` per row, in the row's last cell. Every button posts the same
 * action with a different `op`.
 */
export function TierEditor({
  tiers,
  counts,
}: {
  tiers: SponsorTierDef[];
  /** Sponsors per tier id, so Remove can say why it is off. */
  counts: Record<string, number>;
}) {
  const [state, action] = useActionState<FormState, FormData>(editSponsorTiersAction, {});
  /** Unsaved edits to a row's name and size, keyed by tier id so a reorder keeps them with their row. */
  const [drafts, setDrafts] = useState<Record<string, { name: string; size: string }>>({});

  return (
    <>
      <FormBanner state={state} style={{ marginBottom: 12 }} />

      <Table
        stackSm
        cols={[
          { key: 'o', label: 'Order', className: 'cell-xs' },
          { key: 't', label: 'Tier', className: 'cell-fill' },
          { key: 'w', label: 'Logo size', className: 'cell-sm' },
          { key: 'n', label: 'Sponsors', className: 'cell-xs' },
          { key: 'a', label: 'Actions', className: 'cell-md' },
        ]}
        rows={tiers.map((t, i) => {
          const inUse = counts[t.id] ?? 0;
          const draft = drafts[t.id] ?? { name: t.name, size: String(t.size) };
          const edit = (patch: Partial<typeof draft>) =>
            setDrafts((d) => ({ ...d, [t.id]: { ...draft, ...patch } }));
          return [
            <span key="o">{i + 1}</span>,
            <input
              key="t"
              aria-label={`Name of tier ${i + 1}`}
              className="whova-text-input"
              value={draft.name}
              onChange={(e) => edit({ name: e.target.value })}
              maxLength={40}
            />,
            <select
              key="w"
              aria-label={`Logo size for ${t.name}`}
              className="whova-text-input"
              value={draft.size}
              onChange={(e) => edit({ size: e.target.value })}
            >
              {SIZES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>,
            <span key="n">{inUse}</span>,
            /*
             * The row's form lives in this one cell, because `Table` renders cells
             * as siblings and a form cannot wrap a row. The name and size boxes
             * are mirrored into it as hidden fields. Each button writes its `op`
             * into a hidden field on click, before the submit fires: a form
             * action does not post the submitter's own name and value.
             */
            <form key="a" action={action} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <input type="hidden" name="id" value={t.id} />
              <input type="hidden" name="name" value={draft.name} />
              <input type="hidden" name="size" value={draft.size} />
              <input type="hidden" name="op" defaultValue="rename" />
              <button onClick={setOp('rename')} className="whova-btn-main small primary">
                Save
              </button>
              <button
                onClick={setOp('up')}
                className="whova-btn-main small secondary"
                disabled={i === 0}
                aria-label={`Move ${t.name} up`}
              >
                Up
              </button>
              <button
                onClick={setOp('down')}
                className="whova-btn-main small secondary"
                disabled={i === tiers.length - 1}
                aria-label={`Move ${t.name} down`}
              >
                Down
              </button>
              <button
                onClick={setOp('remove')}
                className="whova-btn-main small danger"
                disabled={inUse > 0 || tiers.length === 1}
                title={inUse > 0 ? 'Move its sponsors to another tier first' : undefined}
                aria-label={`Remove ${t.name}`}
              >
                Remove
              </button>
            </form>,
          ];
        })}
      />

      <form action={action} style={{ marginTop: 20 }}>
        <input type="hidden" name="op" value="add" />
        <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>Add a tier</h3>
        <FormGrid>
          <Field name="name" label="Tier name" required maxLength={40} width="lg" placeholder="Diamond" />
          <Select name="size" label="Logo size" width="sm" defaultValue="1" options={SIZES} />
        </FormGrid>
        <SubmitButton pendingLabel="Adding…">Add tier</SubmitButton>
      </form>
    </>
  );
}
