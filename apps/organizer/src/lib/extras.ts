import type { ExtraRefusal, ExtraTierShape } from '@kgc/shared';

/**
 * Why an extra (Workshops) cannot be recorded for an address, as the
 * dashboard says it. The website has its own wording for buyers
 * (`apps/web/src/lib/extras-check.ts`); the rule behind both is
 * `chooseExtraBase` in `@kgc/shared`. Since 2026-10-07 an address with no
 * other ticket is not a refusal: it gets a Workshops-only badge.
 */
export function extraRefusalForOrganizer(
  extra: ExtraTierShape,
  email: string,
  reason: ExtraRefusal,
  heldName: string | undefined,
): string {
  switch (reason) {
    case 'included':
      return `${email} holds ${heldName ?? 'a ticket'}, which already includes ${extra.name}. Nothing was recorded.`;
    case 'already':
      return `${email} already has ${extra.name}. Nothing was recorded.`;
  }
}
