'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { CATEGORY_COLORS, type AttendeeCategoryDef } from '@kgc/shared';
import { Field, FormBanner, FormGrid, Select, SubmitButton, type FormState } from '../../form';
import { Table, Tag } from '../../ui';
import { editCategoryAction } from './actions';

/** Set the row form's `op` field to the button that was pressed. */
function setOp(op: string) {
  return (e: React.MouseEvent<HTMLButtonElement>) => {
    const field = e.currentTarget.form?.elements.namedItem('op');
    if (field instanceof HTMLInputElement) field.value = op;
  };
}

const COLORS = CATEGORY_COLORS.map((c) => ({ value: c, label: c[0].toUpperCase() + c.slice(1) }));

/**
 * The category list, editable in place. Same shape as the tier editor on
 * Sponsor Tiering: one `<form>` per row in the row's last cell, every button
 * posting the same action with a different `op`.
 */
export function CategoryEditor({
  categories,
  counts,
  rules,
}: {
  categories: AttendeeCategoryDef[];
  /** People per category id. */
  counts: Record<string, number>;
  /** Ticket types that map to each category id. */
  rules: Record<string, string[]>;
}) {
  const [state, action] = useActionState<FormState, FormData>(editCategoryAction, {});
  const [drafts, setDrafts] = useState<Record<string, { name: string; color: string }>>({});

  return (
    <>
      <FormBanner state={state} style={{ marginBottom: 12 }} />

      <Table
        stackSm
        cols={[
          { key: 'c', label: 'Category', className: 'cell-fill' },
          { key: 'b', label: 'Badge colour', className: 'cell-sm' },
          { key: 'n', label: 'Attendees', className: 'cell-sm' },
          { key: 't', label: 'Set by ticket', className: 'cell-mdsm' },
          { key: 'a', label: 'Actions', className: 'cell-md' },
        ]}
        rows={categories.map((c) => {
          const inUse = counts[c.id] ?? 0;
          const draft = drafts[c.id] ?? { name: c.name, color: c.color };
          const edit = (patch: Partial<typeof draft>) =>
            setDrafts((d) => ({ ...d, [c.id]: { ...draft, ...patch } }));
          return [
            <input
              key="c"
              aria-label={`Name of ${c.name}`}
              className="whova-text-input"
              value={draft.name}
              onChange={(e) => edit({ name: e.target.value })}
              maxLength={30}
            />,
            <select
              key="b"
              aria-label={`Badge colour for ${c.name}`}
              className="whova-text-input"
              value={draft.color}
              onChange={(e) => edit({ color: e.target.value })}
            >
              {COLORS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>,
            <Link key="n" href={`?category=${c.id}#members`}>
              {inUse}
            </Link>,
            rules[c.id]?.length ? (
              <span key="t">{rules[c.id].join(', ')}</span>
            ) : (
              <span key="t" className="muted">
                —
              </span>
            ),
            <form key="a" action={action} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <input type="hidden" name="id" value={c.id} />
              <input type="hidden" name="name" value={draft.name} />
              <input type="hidden" name="color" value={draft.color} />
              <input type="hidden" name="op" defaultValue="rename" />
              <button onClick={setOp('rename')} className="whova-btn-main small primary">
                Save
              </button>
              <button
                onClick={(e) => {
                  const people = inUse === 1 ? '1 person loses' : `${inUse} people lose`;
                  const ask = inUse > 0 ? `Delete ${c.name}? ${people} this category.` : `Delete ${c.name}?`;
                  if (!window.confirm(ask)) return e.preventDefault();
                  setOp('remove')(e);
                }}
                className="whova-btn-main small danger"
                disabled={categories.length === 1}
                aria-label={`Delete ${c.name}`}
              >
                Delete
              </button>
            </form>,
          ];
        })}
      />

      <form action={action} style={{ marginTop: 20 }}>
        <input type="hidden" name="op" value="add" />
        <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>Add a category</h3>
        <FormGrid>
          <Field name="name" label="Category name" required maxLength={30} width="lg" placeholder="Media partner" />
          <Select name="color" label="Badge colour" width="sm" defaultValue="grey" options={COLORS} />
        </FormGrid>
        <SubmitButton pendingLabel="Adding…">Add category</SubmitButton>
      </form>

      <p className="muted" style={{ fontSize: 12, marginTop: 14, marginBottom: 0 }}>
        Preview:{' '}
        {categories.map((c) => (
          <span key={c.id} style={{ marginRight: 6 }}>
            <Tag color={c.color} fill="solid" small>
              {c.name}
            </Tag>
          </span>
        ))}
      </p>
    </>
  );
}
