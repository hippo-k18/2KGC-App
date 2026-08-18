/**
 * The three pale cards under the hero.
 *
 * Measured off the live page, not eyeballed: card background `#f7fafc`
 * (`--palette-8`), padding `48px 24px`, heading 32px/48px weight 400 in
 * `--navy` with the numeral alone at weight 700, body 20px/32px centred.
 *
 * The numbers are the caller's problem, deliberately. Two of the three are
 * `count()` results from Firestore and one is a stated expectation
 * (`ATTENDEES_EXPECTED`), and the page says which is which in the copy rather
 * than dressing a guess up as a measurement — a hardcoded count on a site whose
 * own database contradicts it is the defect class this repo keeps finding in
 * itself.
 */
export interface Stat {
  value: string;
  noun: string;
  blurb: string;
}

export function StatBlocks({ stats }: { stats: Stat[] }) {
  return (
    <section className="kgc-stats" aria-label="Conference at a glance">
      <div className="kgc-wide kgc-stats-row">
        {stats.map((s) => (
          <div className="kgc-stat" key={s.noun}>
            <h2>
              <strong>{s.value}</strong> {s.noun}
            </h2>
            <p>{s.blurb}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
