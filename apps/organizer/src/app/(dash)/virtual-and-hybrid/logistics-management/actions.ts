'use server';

import { requireOrganizer } from '@/lib/auth';
import { SETTINGS_KEYS, saveSettings } from '@/lib/settings';

export interface EmergencyState {
  ok?: boolean;
  message?: string;
  error?: string;
}

/** Free-text fields are capped so a paste accident cannot bloat the document. */
function text(form: FormData, key: string, max: number): string {
  return String(form.get(key) ?? '')
    .trim()
    .slice(0, max);
}

/**
 * Emergency contacts, in the `logistics` settings bag.
 *
 * ── Validation is deliberately loose ────────────────────────────────────────
 *
 * The obvious instinct is to validate phone numbers. Resisted: this card gets
 * filled in with things like "Campus security, ext. 4400" and "Tim — WhatsApp
 * only", and a regex that rejects those makes the field unusable at exactly the
 * moment somebody is trying to record a real contact quickly. The only hard
 * rule is that an assembly point and a lead cannot both be blank while the
 * card is marked ready, because a ready card that says nothing is worse than an
 * obviously empty one.
 */
export async function saveEmergencyPlanAction(
  _prev: EmergencyState,
  formData: FormData,
): Promise<EmergencyState> {
  const actor = await requireOrganizer();

  const values = {
    emergencyNumber: text(formData, 'emergencyNumber', 40),
    venueSecurity: text(formData, 'venueSecurity', 120),
    medicalPoint: text(formData, 'medicalPoint', 160),
    assemblyPoint: text(formData, 'assemblyPoint', 160),
    onSiteLead: text(formData, 'onSiteLead', 120),
    onSiteLeadPhone: text(formData, 'onSiteLeadPhone', 60),
    incidentProcedure: text(formData, 'incidentProcedure', 2000),
    planReady: formData.get('planReady') === 'on',
  };

  if (values.planReady && !values.assemblyPoint && !values.onSiteLead) {
    return {
      error:
        'Set at least an assembly point and an on-site lead before marking the plan ready — a card with neither is not a plan.',
    };
  }

  const res = await saveSettings(SETTINGS_KEYS.logistics, values, actor);
  return res.ok
    ? { ok: true, message: values.planReady ? 'Saved and marked ready.' : 'Saved as a draft.' }
    : { error: res.error };
}
