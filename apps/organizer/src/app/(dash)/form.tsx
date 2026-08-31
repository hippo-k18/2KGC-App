'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type {
  CSSProperties,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { useFormStatus } from 'react-dom';

/**
 * The form vocabulary — the write half of `ui.tsx`.
 *
 * `ui.tsx` is everything a screen needs to *show* a list. This file is
 * everything it needs to *edit* one, in Whova's `.whova-form-*` /
 * `.whova-btn-main` vocabulary, which is already transcribed into
 * `globals.css` from their production stylesheet.
 *
 * ── Why a second file rather than more of `ui.tsx` ──────────────────────────
 *
 * `ui.tsx` carries no `'use client'`, and it must not: `GapPanel`, `GapTag` and
 * `NotBuilt` call `gapNotesVisible()`, which reads `process.env.SHOW_GAP_NOTES`.
 * Next only inlines `NEXT_PUBLIC_*` into a browser bundle, so the moment
 * `ui.tsx` is pulled across the client boundary that read evaluates to
 * `undefined` and every gap note rendered through it disappears — silently, and
 * in exactly the direction nobody would notice. Everything below needs
 * `useState` / `useFormStatus`, so it is `'use client'`, and it deliberately
 * imports nothing from `ui.tsx`. Where the two overlap (`FormBanner` and
 * `Banner`, `CheckboxField` and `Checkbox`) the markup and the CSS class are
 * the same; only the module is different.
 *
 * ── The shape these components assume ───────────────────────────────────────
 *
 * A React Server Component page reads Firestore, and renders a `'use client'`
 * form component that drives a `'use server'` action through `useActionState`.
 * That is the split the three existing editors use — `1-1-create-tickets`,
 * `session-manager/[id]`, `exhibitor-manager` — and every control below is
 * built for it:
 *
 *   - Values arrive as `defaultValue`, so the form is uncontrolled and one
 *     server round trip does not fight React over what is in the box. The two
 *     exceptions (`MoneyField`, and `ConfirmButton`'s typed phrase) hold state
 *     because they render a live preview of what they are about to send.
 *   - Nothing here calls a server action itself. The form owns the action; the
 *     controls only name fields. That is what keeps them reusable across
 *     twenty editors whose actions have nothing in common.
 *   - `SubmitButton` is a separate component on purpose — `useFormStatus`
 *     reports the status of the form it is rendered *inside*, and returns
 *     `pending: false` forever if it is called in the component that renders
 *     the `<form>` itself.
 *
 * Remounting after a save is the caller's job, and it matters: a server action
 * revalidates the route, the page re-renders with the saved document, and React
 * keeps the DOM node of an uncontrolled input and ignores the new
 * `defaultValue` — so the field goes on showing the old value next to a green
 * "Saved." Pass `key={version}` on the field, as `session-form.tsx` does.
 */

/**
 * The result a form action hands back to `useActionState`.
 *
 * Twenty-five action modules already declare a private result interface —
 * `TicketState`, `SaveState`, `ExhibitorState`, `CampaignState`, and so on —
 * and every one of them opens with the same three optional fields. This is that
 * shape, named once, so a component can accept any of them without importing
 * the action it came from.
 *
 * **The existing interfaces are not rewritten.** They do not need to be:
 * TypeScript is structural, so a `TicketState` value is already a `FormState`,
 * and `SaveState`'s extra `pushNote` or `CampaignState`'s `keep` stay private to
 * the screen that needs them. New actions should `extends FormState` and add
 * their own fields; old ones converge for free the day someone touches them.
 *
 * `fieldErrors` is the one addition. Existing actions return a single `error`
 * string, which is right when a form has six fields and wrong when it has
 * twenty and the organizer has to guess which one the sentence is about.
 * Keyed by the field's `name`, so `<Field error={state.fieldErrors?.price} />`
 * puts the message under the box that caused it.
 */
export interface FormState {
  ok?: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
}

/**
 * Whova sizes inputs by class rather than by content: 172 / 394 / 680px. Those
 * three are in `globals.css` because they are theirs; `full` is the absence of
 * a width class, which `.whova-text-input` already renders as 100%.
 */
export type FieldWidth = 'sm' | 'lg' | 'xl' | 'full';

const WIDTH_CLASS: Record<FieldWidth, string> = {
  sm: 'whova-input-sm',
  lg: 'whova-input-lg',
  xl: 'whova-input-xl',
  full: '',
};

function inputClass(width: FieldWidth | undefined, invalid: boolean): string {
  return ['whova-text-input', width ? WIDTH_CLASS[width] : '', invalid ? 'error' : '']
    .filter(Boolean)
    .join(' ');
}

/**
 * Label, control, error, hint — in that order, and always in that order.
 *
 * The error goes *above* the hint rather than below it because the hint is
 * standing advice ("blank for unlimited") and the error is about what was just
 * typed; putting the transient message under the permanent one buries it.
 */
function FieldFrame({
  htmlFor,
  label,
  required,
  hint,
  error,
  children,
  style,
}: {
  htmlFor?: string;
  label?: ReactNode;
  required?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div className="whova-form-group" style={style}>
      {label ? (
        <div className="whova-form-label">
          <label htmlFor={htmlFor}>{label}</label>
          {required ? (
            <span className="whova-form-label-suffix" aria-hidden="true">
              *
            </span>
          ) : null}
        </div>
      ) : null}
      {children}
      {error ? (
        <p className="whova-form-error-message" role="alert">
          {error}
        </p>
      ) : null}
      {hint ? <p className="whova-form-description">{hint}</p> : null}
    </div>
  );
}

type ControlExtras = {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  width?: FieldWidth;
  /** Applied to the group, not the control — the control is sized by `width`. */
  groupStyle?: CSSProperties;
};

export type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> &
  ControlExtras & { name: string };

/**
 * One labelled text input.
 *
 * Everything `<input>` accepts passes straight through — `type`, `maxLength`,
 * `min`, `inputMode`, `pattern`, `readOnly` — because the alternative is a prop
 * list that grows by one every time an editor needs something ordinary, and the
 * thing being wrapped is already a perfectly good control.
 */
export function Field({
  label,
  hint,
  error,
  width,
  groupStyle,
  id,
  name,
  required,
  ...rest
}: FieldProps) {
  const fallbackId = useId();
  const fieldId = id ?? name ?? fallbackId;
  return (
    <FieldFrame
      htmlFor={fieldId}
      label={label}
      required={required}
      hint={hint}
      error={error}
      style={groupStyle}
    >
      <input
        {...rest}
        id={fieldId}
        name={name}
        required={required}
        aria-invalid={error ? true : undefined}
        className={inputClass(width, Boolean(error))}
      />
    </FieldFrame>
  );
}

export type TextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> &
  ControlExtras & { name: string };

/** The same frame around a `<textarea>`. `.whova-text-input` covers both. */
export function Textarea({
  label,
  hint,
  error,
  width,
  groupStyle,
  id,
  name,
  required,
  rows = 6,
  ...rest
}: TextareaProps) {
  const fallbackId = useId();
  const fieldId = id ?? name ?? fallbackId;
  return (
    <FieldFrame
      htmlFor={fieldId}
      label={label}
      required={required}
      hint={hint}
      error={error}
      style={groupStyle}
    >
      <textarea
        {...rest}
        id={fieldId}
        name={name}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        className={inputClass(width, Boolean(error))}
      />
    </FieldFrame>
  );
}

export interface SelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> &
  ControlExtras & {
    name: string;
    options?: SelectOption[];
    /**
     * A leading empty option. Give it the text the organizer should read when
     * nothing is chosen — `"— no room —"`, not `"Select…"` — because on a form
     * that saves, the empty option is a real answer and it should say what
     * choosing it means.
     */
    placeholder?: string;
  };

export function Select({
  label,
  hint,
  error,
  width,
  groupStyle,
  id,
  name,
  required,
  options,
  placeholder,
  children,
  ...rest
}: SelectProps) {
  const fallbackId = useId();
  const fieldId = id ?? name ?? fallbackId;
  return (
    <FieldFrame
      htmlFor={fieldId}
      label={label}
      required={required}
      hint={hint}
      error={error}
      style={groupStyle}
    >
      <select
        {...rest}
        id={fieldId}
        name={name}
        required={required}
        aria-invalid={error ? true : undefined}
        className={inputClass(width, Boolean(error))}
      >
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options?.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
        {children}
      </select>
    </FieldFrame>
  );
}

/**
 * Trim a stored timestamp to what `datetime-local` will accept.
 *
 * The control's value format is exactly `YYYY-MM-DDTHH:mm` — no seconds, no
 * zone — and it silently renders **blank** for anything else rather than
 * complaining, which is how an editor ends up showing an empty date over a
 * document that has one. Slicing is deliberate rather than parsing: these
 * strings are wall clock in the event's timezone, and putting them through
 * `new Date()` in the browser would reinterpret them in the organizer's.
 */
export function dateTimeValue(stored?: string | null): string | undefined {
  if (!stored) return undefined;
  return stored.slice(0, 16);
}

export type DateTimeFieldProps = Omit<FieldProps, 'type'> & {
  /** Named for what it is: a wall clock, not an instant. */
  timeZoneNote?: string;
};

/**
 * A `datetime-local` field.
 *
 * Separate from `Field` only so that the value trimming above happens by
 * default and the timezone caveat has somewhere to live. `defaultValue` is put
 * through `dateTimeValue`, so a caller can hand it a full ISO string.
 */
export function DateTimeField({
  defaultValue,
  value,
  hint,
  timeZoneNote,
  ...rest
}: DateTimeFieldProps) {
  return (
    <Field
      {...rest}
      type="datetime-local"
      defaultValue={typeof defaultValue === 'string' ? dateTimeValue(defaultValue) : defaultValue}
      value={typeof value === 'string' ? dateTimeValue(value) : value}
      hint={
        timeZoneNote ? (
          <>
            {hint ? <>{hint} </> : null}
            Wall clock in {timeZoneNote}.
          </>
        ) : (
          hint
        )
      }
    />
  );
}

/**
 * What the ticket action's `parseMoney` accepts, restated for the browser.
 *
 * Deliberately a copy rather than an import: `parseMoney` lives in a
 * `'use server'` module and importing it here would drag a server action file
 * into a client bundle. The server stays the authority — this only decides
 * whether the preview under the box says a number or says "enter whole
 * dollars", and a disagreement between the two costs a rejected save, not a
 * wrong charge.
 */
const MONEY_PATTERN = /^\d+(\.\d{1,2})?$/;

/** `"$1,199.00"` → `"1199.00"`. Same strip the action does before it parses. */
export function normaliseMoney(raw: string): string {
  return raw.replace(/[$,\s]/g, '');
}

/** Minor units out of Firestore → the whole units a human types. */
export function wholeUnits(minorUnits: number): string {
  return String(minorUnits / 100);
}

export interface MoneyFieldProps extends ControlExtras {
  name: string;
  id?: string;
  required?: boolean;
  /** Whole units, as a string. `wholeUnits(doc.priceCents)` produces it. */
  defaultValue?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Renders a currency `<select>` beside the amount when set. */
  currencyName?: string;
  currencyDefault?: string;
  currencies?: string[];
}

/**
 * Money in, minor units out.
 *
 * ── Whole units are entered, minor units are stored ──────────────────────────
 *
 * The organizer types `799`; the action multiplies by 100 and Firestore holds
 * `79900`. Asking a human for cents is how a ticket ends up costing $7.99 or
 * $79,900 depending on who filled the form in, and neither mistake announces
 * itself — `ticketTypes` is what Stripe is handed, so the number in this box is
 * the number on somebody's card statement.
 *
 * The live preview beside the field exists for the same reason: it echoes the
 * parsed figure back in the format the website will print, so a slipped decimal
 * is visible before saving rather than after selling. It follows the currency
 * dropdown, because a price shown in the wrong currency is exactly the class of
 * error the preview is there to catch.
 */
export function MoneyField({
  name,
  id,
  label,
  hint,
  error,
  required,
  defaultValue = '',
  placeholder = '799',
  disabled,
  width = 'sm',
  groupStyle,
  currencyName,
  currencyDefault = 'usd',
  currencies = ['usd', 'eur', 'gbp'],
}: MoneyFieldProps) {
  const fallbackId = useId();
  const fieldId = id ?? name ?? fallbackId;
  const [amount, setAmount] = useState(defaultValue);
  const [currency, setCurrency] = useState(currencyDefault);

  /**
   * Re-seed when the document underneath changes.
   *
   * This is the controlled version of the bug `session-form.tsx` documents on
   * its `key={version}`: navigate from editing one tier to editing another and
   * React reuses this component, so `useState`'s initial value — the first
   * tier's price — is still what the box holds and still what a Save would
   * write. Adjusting during render is React's own answer to a prop that owns a
   * piece of state; the alternative is an effect that renders the wrong price
   * once before correcting it, which is one screenshot away from being believed.
   */
  const [seed, setSeed] = useState(defaultValue);
  if (seed !== defaultValue) {
    setSeed(defaultValue);
    setAmount(defaultValue);
    setCurrency(currencyDefault);
  }

  const cleaned = normaliseMoney(amount);
  const valid = MONEY_PATTERN.test(cleaned);

  return (
    <FieldFrame
      htmlFor={fieldId}
      label={label}
      required={required}
      hint={hint}
      error={error}
      style={groupStyle}
    >
      <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <input
          id={fieldId}
          name={name}
          required={required}
          disabled={disabled}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={placeholder}
          inputMode="decimal"
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          className={inputClass(width, Boolean(error))}
        />
        {currencyName ? (
          <select
            name={currencyName}
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            disabled={disabled}
            aria-label="Currency"
            className="whova-text-input"
            style={{ maxWidth: 96 }}
          >
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c.toUpperCase()}
              </option>
            ))}
          </select>
        ) : null}
        <span className="muted" style={{ fontSize: 13 }} aria-live="polite">
          {valid ? (
            <>
              Buyers are charged{' '}
              <strong>
                {new Intl.NumberFormat('en-US', {
                  style: 'currency',
                  currency: currency.toUpperCase(),
                }).format(Number(cleaned))}
              </strong>
            </>
          ) : (
            'Enter whole units, e.g. 799'
          )}
        </span>
      </div>
    </FieldFrame>
  );
}

/**
 * Whova's 16px checkbox, with the label / hint / error frame around it.
 *
 * Not a re-export of `ui.tsx`'s `Checkbox` — see the note at the top of this
 * file about what importing that module across the client boundary would do to
 * the gap notes. The markup and the CSS class are identical; what this adds is
 * the framing an editor needs and a list screen does not.
 */
export function CheckboxField({
  name,
  value,
  label,
  description,
  defaultChecked,
  checked,
  onChange,
  disabled,
}: {
  name?: string;
  value?: string;
  label: ReactNode;
  description?: ReactNode;
  defaultChecked?: boolean;
  checked?: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="whova-checkbox-label">
        <input
          className="whova-checkbox-input"
          type="checkbox"
          name={name}
          value={value}
          defaultChecked={defaultChecked}
          checked={checked}
          onChange={onChange ? (e) => onChange(e.target.checked) : undefined}
          disabled={disabled}
        />
        <span>{label}</span>
      </label>
      {description ? <div className="whova-checkbox-description">{description}</div> : null}
    </div>
  );
}

/**
 * A titled group of related controls — the "Options" block of checkboxes, a set
 * of radios, two dates that mean one sales window.
 *
 * A real `<fieldset>` and `<legend>`, so a screen reader announces the group
 * name before each option rather than reading nine unrelated checkboxes. The
 * inline reset is unavoidable: `<fieldset>` ships a border and an inset margin
 * that nothing else on the page has, and `globals.css` deliberately styles no
 * bare elements.
 */
export function FieldSet({
  legend,
  hint,
  error,
  children,
  inline,
}: {
  legend?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  /** Lay the options out in a row instead of a column. */
  inline?: boolean;
}) {
  return (
    <fieldset
      className="whova-form-group"
      style={{ border: 0, marginInline: 0, minWidth: 0, padding: 0 }}
    >
      {legend ? (
        <legend className="whova-form-label" style={{ padding: 0 }}>
          {legend}
        </legend>
      ) : null}
      <div
        className="whova-checkbox-group"
        style={inline ? { display: 'flex', flexWrap: 'wrap', gap: 16 } : undefined}
      >
        {children}
      </div>
      {error ? (
        <p className="whova-form-error-message" role="alert">
          {error}
        </p>
      ) : null}
      {hint ? <p className="whova-form-description">{hint}</p> : null}
    </fieldset>
  );
}

/**
 * Side-by-side fields. `.form-row` is Whova's: flex, 16px gap, and every
 * `.whova-form-group` inside it grows from a 200px floor, so a narrow window
 * wraps them into a column rather than crushing them.
 */
export function FormGrid({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="form-row" style={style}>
      {children}
    </div>
  );
}

/**
 * The button row at the foot of a form.
 *
 * Left-aligned by default, matching `session-form.tsx` and the rest of the
 * dashboard: the buttons sit under the fields they apply to, where the eye
 * already is after reading the last label.
 */
export function FormActions({
  children,
  align = 'left',
  style,
}: {
  children: ReactNode;
  align?: 'left' | 'right';
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
        marginTop: 20,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

/**
 * Submit, with the pending state the form actually has.
 *
 * `useFormStatus` reports the status of the enclosing `<form>`, and only from a
 * component rendered *inside* it — called in the component that renders the
 * form, it returns `pending: false` for ever. So this is its own component, and
 * that is the whole reason it exists rather than being a `<button>` at the call
 * site.
 *
 * It matters more than a spinner usually does here. A save goes to Firestore
 * and sometimes to Stripe; an unchanged button is a button somebody clicks
 * twice, and on the refund path the second click is a second refund.
 */
export function SubmitButton({
  children,
  pendingLabel = 'Saving…',
  variant = 'primary',
  small,
  disabled,
  style,
  name,
  value,
}: {
  children: ReactNode;
  pendingLabel?: ReactNode;
  variant?: ButtonVariant;
  small?: boolean;
  disabled?: boolean;
  style?: CSSProperties;
  /** For a form with two submits — `name`/`value` say which one was pressed. */
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      className={`whova-btn-main ${variant}${small ? ' small' : ''}`}
      disabled={pending || disabled}
      style={style}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

/**
 * The result of the last submit, said once at the top of the form.
 *
 * Whova's banner rather than a bare coloured sentence, because a save
 * confirmation that looks like body text is a save confirmation nobody sees.
 * `role="alert"` on the failure and `role="status"` on the success is the
 * difference between interrupting a screen reader and not: a rejected save
 * needs to interrupt, a successful one does not.
 *
 * Takes the whole `useActionState` result rather than a message, so a form
 * cannot render a success banner and a stale error at the same time.
 */
export function FormBanner({
  state,
  successFallback = 'Saved.',
  style,
}: {
  state: FormState;
  successFallback?: ReactNode;
  style?: CSSProperties;
}) {
  if (state.error) {
    return (
      <div className="whova-banner danger" role="alert" style={style}>
        <div>{state.error}</div>
      </div>
    );
  }
  if (state.ok) {
    return (
      <div className="whova-banner success" role="status" style={style}>
        <div>{state.message ?? successFallback}</div>
      </div>
    );
  }
  return null;
}

/**
 * A modal, on the native `<dialog>`.
 *
 * `order-actions.tsx` argues against modals and it is right about what it is
 * arguing against: a `<div>` overlay needs focus trapping, an escape handler
 * and background inertness written by hand, and all three are easy to get
 * subtly wrong. `<dialog>` opened with `showModal()` has all three from the
 * platform — focus is trapped, Escape closes, everything behind it is inert —
 * so this is that component rather than a rebuilt one. What it does not have is
 * a scroll lock, which `globals.css` adds with `html:has(dialog[open])`.
 *
 * It is still the wrong control for a confirmation. Escape and a backdrop click
 * both dismiss a `<dialog>`, so a half-typed refund confirmation can vanish
 * under a stray key; `ConfirmButton` below stays a `<details>` for exactly that
 * reason. Use this for an editor that is too big for a table row and too small
 * for a route of its own.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 560,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="whova-modal"
      aria-labelledby={headingId}
      style={{ width }}
      /*
       * Guarded on the current `open`. Closing the dialog from the effect above
       * also fires this, and an unguarded call would tell the parent to close
       * something it has already closed — harmless with a `setState(false)`,
       * a loop with anything that toggles.
       */
      onClose={() => {
        if (open) onClose();
      }}
    >
      <div className="whova-modal__header">
        <h2 id={headingId} className="section-header" style={{ margin: 0 }}>
          {title}
        </h2>
        <button
          type="button"
          className="whova-modal__close"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
      </div>
      <div className="whova-modal__body">{children}</div>
      {footer ? <div className="whova-modal__footer">{footer}</div> : null}
    </dialog>
  );
}

/**
 * A destructive action, and the sentence that has to be read before it runs.
 *
 * A `<details>` rather than a modal, and that is the considered choice rather
 * than the lazy one — it is the pattern `order-actions.tsx` arrived at for the
 * refund button. A disclosure is native, keyboard-accessible for free, and, the
 * part that matters, **cannot be dismissed by clicking somewhere else**, so a
 * half-typed confirmation does not silently vanish under a stray click.
 *
 * `confirmPhrase` asks the organizer to type something from the row — an
 * amount, a name — rather than tick a box. A checkbox becomes muscle memory
 * after the third deletion; typing the figure requires reading which row you
 * are on, which is the mistake this is actually defending against.
 *
 * ⚠️ The disabled submit is a convenience, not a guard. The phrase is posted as
 * `confirm` and the action **must** re-check it: anything enforced only in the
 * browser is enforced only for people who did not think to look.
 */
export function ConfirmButton({
  action,
  label,
  confirmLabel,
  children,
  confirmPhrase,
  hidden,
  variant = 'danger',
  trigger = 'link',
  disabled,
  width = 320,
}: {
  /** The server action. Bind anything it needs, or pass it via `hidden`. */
  action: (formData: FormData) => void | Promise<void>;
  label: ReactNode;
  /** The submit's text. Defaults to `label`. */
  confirmLabel?: ReactNode;
  /** The consequences, spelled out. This is the point of the component. */
  children: ReactNode;
  confirmPhrase?: string;
  /** Extra fields the action needs — an id, usually. */
  hidden?: Record<string, string>;
  variant?: ButtonVariant;
  trigger?: 'link' | 'button';
  disabled?: boolean;
  width?: number;
}) {
  const [typed, setTyped] = useState('');
  const armed = !confirmPhrase || typed.trim() === confirmPhrase;

  return (
    <details style={{ display: 'inline-block' }}>
      <summary
        className={trigger === 'link' ? 'linkish' : `whova-btn-main small ${variant}`}
        style={{
          cursor: 'pointer',
          listStyle: 'none',
          ...(trigger === 'link' && variant === 'danger' ? { color: 'var(--danger)' } : null),
        }}
      >
        {label}
      </summary>

      <form
        action={action}
        style={{
          background: 'var(--surface-alt)',
          border: '1px solid var(--hairline)',
          borderRadius: 4,
          marginTop: 8,
          padding: 12,
          width,
        }}
      >
        {Object.entries(hidden ?? {}).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}

        <div style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 10 }}>{children}</div>

        {confirmPhrase ? (
          <Field
            name="confirm"
            label={
              <>
                Type <code>{confirmPhrase}</code> to confirm
              </>
            }
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={confirmPhrase}
            autoComplete="off"
            groupStyle={{ marginBottom: 10 }}
          />
        ) : null}

        <SubmitButton
          variant={variant}
          small
          disabled={disabled || !armed}
          pendingLabel="Working…"
          style={{ width: '100%' }}
        >
          {confirmLabel ?? label}
        </SubmitButton>
      </form>
    </details>
  );
}
