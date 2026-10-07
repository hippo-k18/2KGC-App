'use client';

import { useActionState } from 'react';
import type { AttendeeCategoryDef } from '@kgc/shared';
import { FormBanner, SubmitButton, type FormState } from '../../../form';
import { Table } from '../../../ui';
import { saveTicketRuleAction } from '../../../attendees/categories/actions';

export interface TicketRuleRow {
  ticketType: string;
  /** False for a type people hold that is not in the ticket list, such as an import. */
  onSale: boolean;
  holders: number;
  categoryId: string;
}

/**
 * One row per ticket type, each its own form: pick a category, save. One
 * `useActionState` for the table, so the banner names the last rule saved.
 */
export function RuleEditor({
  rows,
  categories,
}: {
  rows: TicketRuleRow[];
  categories: AttendeeCategoryDef[];
}) {
  const [state, action] = useActionState<FormState, FormData>(saveTicketRuleAction, {});

  return (
    <>
      <FormBanner state={state} style={{ marginBottom: 12 }} />
      <Table
        stackSm
        cols={[
          { key: 't', label: 'Ticket type', className: 'cell-fill' },
          { key: 'h', label: 'Holders', className: 'cell-sm' },
          { key: 'c', label: 'Category', className: 'cell-lg' },
        ]}
        empty="No ticket types yet"
        rows={rows.map((r) => [
          <span key="t">
            <strong>{r.ticketType}</strong>
            {!r.onSale && (
              <div className="muted" style={{ fontSize: 12 }}>
                Not in the ticket list
              </div>
            )}
          </span>,
          <span key="h">{r.holders}</span>,
          <form key={`${r.ticketType}:${r.categoryId}`} action={action} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <input type="hidden" name="ticketType" value={r.ticketType} />
            <select
              name="categoryId"
              aria-label={`Category for ${r.ticketType}`}
              className="whova-text-input"
              defaultValue={r.categoryId}
              style={{ width: 200 }}
            >
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <SubmitButton small>Save</SubmitButton>
          </form>,
        ])}
      />
    </>
  );
}
