'use client';

import { useEffect, useRef, useState } from 'react';
import { MAX_MERCH_QUANTITY, MERCH_PICKUP_NOTE, encodeMerchChoice, type MerchItem } from '@kgc/shared';
import { formatPrice } from '@/lib/tickets';

/**
 * Merch on a form (T380): a quantity per item, and a design and size where the
 * item has them. Posts one hidden `merchLine` per line with a quantity, ids
 * only; the server prices it again from `merchItems`.
 *
 * An item with designs or sizes can take several lines ("two Et al. in M, one
 * in L"), added with "Add another".
 *
 * `compact` is the checkout's version (T417): no image, one row per item on a
 * desktop (name and price, then the choices), the field names inside the
 * selects instead of above them. `/tickets/merch` keeps the full layout.
 */
interface Line {
  key: number;
  itemId: string;
  optionId: string;
  size: string;
  quantity: number;
}

export function MerchPicker({
  items,
  onTotalChange,
  title = 'Add merch',
  compact = false,
}: {
  items: MerchItem[];
  onTotalChange?: (cents: number) => void;
  title?: string | null;
  compact?: boolean;
}) {
  const nextKey = useRef(items.length);
  const [lines, setLines] = useState<Line[]>(() =>
    items.map((item, i) => ({ key: i, itemId: item.id, optionId: '', size: '', quantity: 0 })),
  );
  const priceOf = (id: string) => items.find((i) => i.id === id)?.priceCents ?? 0;
  const total = lines.reduce((sum, l) => sum + l.quantity * priceOf(l.itemId), 0);

  useEffect(() => {
    onTotalChange?.(total);
  }, [total, onTotalChange]);

  if (items.length === 0) return null;

  const update = (key: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = (itemId: string) =>
    setLines((prev) => {
      nextKey.current += 1;
      const at = prev.map((l) => l.itemId).lastIndexOf(itemId);
      const next = [...prev];
      next.splice(at + 1, 0, { key: nextKey.current, itemId, optionId: '', size: '', quantity: 1 });
      return next;
    });
  const removeLine = (key: number) => setLines((prev) => prev.filter((l) => l.key !== key));

  return (
    <section className={compact ? 'merch merch-compact' : 'merch'} aria-labelledby={title ? 'merch-title' : undefined}>
      {title ? (
        <h3 className="merch-title" id="merch-title">
          {title}
        </h3>
      ) : null}
      <p className="hint merch-pickup">{MERCH_PICKUP_NOTE}</p>

      {items.map((item) => {
        const own = lines.filter((l) => l.itemId === item.id);
        const choosable = item.options.length > 0 || item.sizes.length > 0;
        const name = (
          <p className="merch-name">
            <span>{item.name}</span>
            <span className="merch-price">{formatPrice(item.priceCents, item.currency)}</span>
          </p>
        );
        // In the compact layout the field's name is the select's empty choice,
        // and the label stays for screen readers.
        const labelClass = compact ? 'sr-only' : undefined;
        return (
          <div className="merch-item" key={item.id}>
            {compact ? null : item.imageUrl ? (
              <img className="merch-image" src={item.imageUrl} alt="" />
            ) : (
              <span className="merch-image merch-image-empty" aria-hidden="true">
                {item.name.slice(0, 1)}
              </span>
            )}
            {compact ? name : null}
            <div className={compact ? 'merch-lines' : 'merch-body'}>
              {compact ? null : name}
              {own.map((line, n) => {
                const base = `merch-${item.id}-${line.key}`;
                const needed = line.quantity > 0;
                return (
                  <div className="merch-line" key={line.key}>
                    {item.options.length > 0 && (
                      <div className="field merch-field merch-field-wide">
                        <label htmlFor={`${base}-o`} className={labelClass}>
                          Design
                        </label>
                        <select
                          id={`${base}-o`}
                          value={line.optionId}
                          required={needed}
                          onChange={(e) => update(line.key, { optionId: e.target.value })}
                        >
                          <option value="">{compact ? 'Design' : 'Choose'}</option>
                          {item.options.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    {item.sizes.length > 0 && (
                      <div className="field merch-field">
                        <label htmlFor={`${base}-s`} className={labelClass}>
                          Size
                        </label>
                        <select
                          id={`${base}-s`}
                          value={line.size}
                          required={needed}
                          onChange={(e) => update(line.key, { size: e.target.value })}
                        >
                          <option value="">{compact ? 'Size' : 'Choose'}</option>
                          {item.sizes.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="field merch-field merch-qty">
                      <label htmlFor={`${base}-q`}>
                        {compact ? (
                          <>
                            <span className="merch-qty-word" aria-hidden="true">
                              Qty
                            </span>
                            <span className="sr-only">Quantity</span>
                          </>
                        ) : (
                          'Quantity'
                        )}
                      </label>
                      <select
                        id={`${base}-q`}
                        value={line.quantity}
                        onChange={(e) => update(line.key, { quantity: Number(e.target.value) })}
                      >
                        {Array.from({ length: MAX_MERCH_QUANTITY + 1 }, (_, q) => (
                          <option key={q} value={q}>
                            {q}
                          </option>
                        ))}
                      </select>
                    </div>
                    {n > 0 && (
                      <button
                        type="button"
                        className="merch-remove"
                        aria-label={compact ? 'Remove' : undefined}
                        onClick={() => removeLine(line.key)}
                      >
                        {compact ? '×' : 'Remove'}
                      </button>
                    )}
                    {line.quantity > 0 && (
                      <input
                        type="hidden"
                        name="merchLine"
                        value={encodeMerchChoice({
                          itemId: item.id,
                          optionId: line.optionId || undefined,
                          size: line.size || undefined,
                          quantity: line.quantity,
                        })}
                      />
                    )}
                  </div>
                );
              })}
              {choosable && own.some((l) => l.quantity > 0) && (
                <button type="button" className="merch-add" onClick={() => addLine(item.id)}>
                  Add another
                </button>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}
