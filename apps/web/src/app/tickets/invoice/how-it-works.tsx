import s from './invoice.module.css';

/**
 * The four steps, shared by the form's rail and the closed notice. Only the
 * first step changes wording when invoicing is closed: with no form on the
 * page, "you list who's coming" would describe something that is not there.
 */
export function HowItWorks({ open }: { open: boolean }) {
  return (
    <section className={s.steps} aria-labelledby="how-it-works">
      <h2 id="how-it-works" className={s.stepsTitle}>
        How it works
      </h2>
      <ol>
        <li>
          {open
            ? 'You list who’s coming and who pays. Nothing is charged yet.'
            : 'You email us who’s coming and who pays. Nothing is charged yet.'}
        </li>
        <li>We email the invoice to your billing contact, with the PO number on the PDF.</li>
        <li>Finance pays it by card or bank transfer, on the terms you chose.</li>
        <li>
          <strong>When it clears</strong>, each attendee gets their own ticket by email.
        </li>
      </ol>
    </section>
  );
}
