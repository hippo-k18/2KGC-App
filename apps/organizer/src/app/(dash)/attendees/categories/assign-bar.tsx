'use client';

import { useActionState } from 'react';
import type { AttendeeCategoryDef } from '@kgc/shared';
import { FormBanner, SubmitButton, type FormState } from '../../form';
import { assignCategoryAction } from './actions';

/**
 * Assign a category to the rows ticked in a list.
 *
 * The list is a server-rendered `Table`, whose cells are siblings, so a form
 * cannot wrap its rows. Each row's checkbox instead names this form with the
 * `form` attribute (`RowCheckbox` below), which posts it as though it were
 * inside. No selection state is kept here: what is ticked is what is sent.
 */
export function AssignBar({
  formId,
  categories,
}: {
  formId: string;
  categories: AttendeeCategoryDef[];
}) {
  const [state, action] = useActionState<FormState, FormData>(assignCategoryAction, {});

  const tickAll = (on: boolean) => {
    document
      .querySelectorAll<HTMLInputElement>(`input[type="checkbox"][form="${formId}"]`)
      .forEach((box) => {
        box.checked = on;
      });
  };

  return (
    <>
      <FormBanner state={state} style={{ marginBottom: 12 }} />
      <form id={formId} action={action} className="toolbar" style={{ alignItems: 'center' }}>
        <button type="button" className="btn btn-default" onClick={() => tickAll(true)}>
          Select all on this page
        </button>
        <button type="button" className="btn btn-default" onClick={() => tickAll(false)}>
          Select none
        </button>
        <select
          name="categoryId"
          aria-label="Category for the selected attendees"
          className="whova-text-input"
          defaultValue={categories[0]?.id ?? ''}
          style={{ width: 200 }}
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value="">No category</option>
        </select>
        <SubmitButton pendingLabel="Assigning…">Assign to selected</SubmitButton>
      </form>
    </>
  );
}

/** One row's tick box, posted with the `AssignBar` form of the same id. */
export function RowCheckbox({ formId, rid, name }: { formId: string; rid: string; name: string }) {
  return (
    <label className="whova-checkbox-label" style={{ margin: 0 }}>
      <input
        className="whova-checkbox-input"
        type="checkbox"
        name="rid"
        value={rid}
        form={formId}
        aria-label={`Select ${name}`}
      />
    </label>
  );
}
