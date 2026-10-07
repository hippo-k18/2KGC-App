import type { ExtraRefusal, ExtraTierShape } from '@kgc/shared';

/**
 * Why an extra (Workshops) cannot be recorded for an address, as the
 * dashboard says it. The website has its own wording for buyers
 * (`apps/web/src/lib/extras-check.ts`); the rule behind both is
 * `chooseExtraBase` in `@kgc/shared`.
 */
export function extraRefusalForOrganizer(
  extra: ExtraTierShape,
  email: string,
  reason: ExtraRefusal,
  heldName: string | undefined,
  byName: Map<string, ExtraTierShape>,
): string {
  const needs = [...byName.values()].find((t) => t.id === extra.addOnFor)?.name ?? 'Main Conference';
  switch (reason) {
    case 'included':
      return `${email} holds ${heldName ?? 'a ticket'}, which already includes ${extra.name}. Nothing was recorded.`;
    case 'already':
      return `${email} already has ${extra.name} on their ticket. Nothing was recorded.`;
    case 'wrong-ticket':
      return `${extra.name} is added to a ${needs} ticket, and ${email} holds ${heldName ?? 'a different ticket'}. Record ${needs} for them first. Nothing was recorded.`;
    case 'no-base':
      return `${extra.name} is added to a ${needs} ticket, and ${email} has none. Record ${needs} for them first, or add this address as an alternate on their ticket. Nothing was recorded.`;
  }
}
