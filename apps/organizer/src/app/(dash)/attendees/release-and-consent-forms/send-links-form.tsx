'use client';

import { useActionState } from 'react';
import type { SigningSendPlan } from '@/lib/consents';
import { sendSigningLinksAction, type ConsentFormState } from './actions';

/**
 * The send step: how many people will be emailed, and a deliberate act to do it.
 *
 * ⚠️ This used to happen inside the save. Publishing a release, or fixing a
 * sentence in one already published, mailed everybody who had not signed with
 * no count, no confirmation and no way to tell how far it got. Each of those
 * mails carries a link that signs a legal release in that person's name, so the
 * cost of one accidental press is measured in people rather than in records.
 *
 * So the count is printed before anything happens, it has to be typed back, and
 * the passphrase is asked for again — the same three guards the email campaign
 * screen uses, for a smaller audience and a heavier mail.
 *
 * The number is "how many will be written to now", not "how many are
 * outstanding". They differ after a send that stopped on the clock, and the
 * number somebody is asked to confirm has to be the number that actually
 * happens.
 */
export function SendSigningLinksForm({
  plan,
  needsPassphrase,
}: {
  plan: SigningSendPlan;
  /** False only on a machine with no passphrase configured, i.e. localhost. */
  needsPassphrase: boolean;
}) {
  const [state, action] = useActionState<ConsentFormState, FormData>(sendSigningLinksAction, {});

  if (!plan.available) return null;

  const nobodyLeft = plan.pending === 0;

  return (
    <div
      style={{
        background: 'var(--surface-alt)',
        border: '1px solid var(--hairline)',
        borderRadius: 4,
        marginBottom: 16,
        padding: 16,
      }}
    >
      <h2 className="section-header" style={{ marginTop: 0 }}>
        Send the signing links
      </h2>

      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p className="ok" role="status">
          {state.message}
        </p>
      )}

      <p className="body-2">
        {nobodyLeft
          ? plan.reachable === 0
            ? 'There is nobody to write to. Everybody in this audience has signed it or has no address on file.'
            : `Everybody waiting to sign version ${plan.version} has already been sent their link.`
          : `${plan.pending} ${plan.pending === 1 ? 'person' : 'people'} will be emailed their own link to sign version ${plan.version}.`}
        {plan.alreadySent > 0 && !nobodyLeft
          ? ` ${plan.alreadySent} already had one and will not be written to again.`
          : ''}
        {plan.noAddress > 0
          ? ` ${plan.noAddress} ${plan.noAddress === 1 ? 'person has' : 'people have'} no address on file, so nothing can reach them.`
          : ''}
      </p>

      {!nobodyLeft && (
        <form action={action}>
          <input type="hidden" name="formId" value={plan.formId} />

          <div className="whova-form-row">
            <label className="whova-form-label" htmlFor="consent-confirm-count">
              Type {plan.pending} to confirm
            </label>
            <input
              id="consent-confirm-count"
              className="whova-text-input"
              name="confirmCount"
              autoComplete="off"
              inputMode="numeric"
              style={{ maxWidth: 120 }}
            />
          </div>

          {needsPassphrase && (
            <div className="whova-form-row">
              <label className="whova-form-label" htmlFor="consent-send-passphrase">
                Your dashboard passphrase
              </label>
              <input
                id="consent-send-passphrase"
                className="whova-text-input"
                name="passphrase"
                type="password"
                autoComplete="off"
                style={{ maxWidth: 240 }}
              />
            </div>
          )}

          <button type="submit" className="whova-btn-main primary">
            Send {plan.pending} {plan.pending === 1 ? 'link' : 'links'}
          </button>
          <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 8 }}>
            Anybody who has already been sent this version is skipped, so pressing Send twice does
            not write to them twice.
          </p>
        </form>
      )}
    </div>
  );
}
