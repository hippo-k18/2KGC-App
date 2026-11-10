'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { MERCH_SIZES, type MerchItemDoc } from '@kgc/shared';
import { IMAGE_ACCEPT_ATTRIBUTE } from '@/lib/upload-limits';
import { saveMerchItemAction, type MerchState } from './actions';

/** Create or edit one merch item. */
export function MerchForm({ item }: { item?: MerchItemDoc & { id: string } }) {
  const [state, action] = useActionState<MerchState, FormData>(saveMerchItemAction, {});
  const key = item?.id ?? 'new';
  return (
    <form action={action} style={{ marginTop: 8 }}>
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.ok && <p className="ok">{state.message}</p>}
      {item && <input type="hidden" name="id" value={item.id} />}
      <input type="hidden" name="sort" value={item?.sort ?? 99} />
      <input type="hidden" name="imageUrl" value={item?.imageUrl ?? ''} />

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor={`${key}-name`}>
          Name
        </label>
        <input id={`${key}-name`} name="name" required maxLength={80} defaultValue={item?.name ?? ''} style={{ maxWidth: 320 }} />
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor={`${key}-price`}>
          Price (USD)
        </label>
        <input
          id={`${key}-price`}
          name="price"
          required
          inputMode="decimal"
          defaultValue={item ? (item.priceCents / 100).toString() : ''}
          style={{ maxWidth: 120 }}
        />
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor={`${key}-options`}>
          Designs
        </label>
        <textarea
          id={`${key}-options`}
          name="options"
          rows={3}
          defaultValue={(item?.options ?? []).map((o) => o.label).join('\n')}
          style={{ maxWidth: 420, width: '100%' }}
        />
        <p className="muted" style={{ fontSize: 12 }}>
          One per line. Leave empty when there is nothing to choose.
        </p>
      </div>

      <fieldset className="whova-form-row" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="whova-form-label">Sizes</legend>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {MERCH_SIZES.map((s) => (
            <label key={s} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              <input type="checkbox" name="size" value={s} defaultChecked={item?.sizes?.includes(s) ?? false} />
              {s}
            </label>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          None ticked: one size.
        </p>
      </fieldset>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor={`${key}-image`}>
          Image
        </label>
        {item?.imageUrl ? (
          <img src={item.imageUrl} alt="" style={{ width: 64, height: 64, objectFit: 'cover', display: 'block', marginBottom: 6 }} />
        ) : (
          <p className="muted" style={{ fontSize: 12, margin: '0 0 6px' }}>
            None yet. The website shows a placeholder.
          </p>
        )}
        <input id={`${key}-image`} type="file" name="image" accept={IMAGE_ACCEPT_ATTRIBUTE} />
      </div>

      <div className="whova-form-row">
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" name="active" defaultChecked={item?.active ?? false} />
          On sale (shown at checkout and on the merch page)
        </label>
      </div>

      <Save label={item ? 'Save' : 'Add item'} />
    </form>
  );
}

function Save({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="whova-btn-main" disabled={pending}>
      {pending ? 'Saving…' : label}
    </button>
  );
}
