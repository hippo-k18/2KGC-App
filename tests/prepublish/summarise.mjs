// Groups failures in reports/results.json by their first error line.
import { readFileSync } from 'node:fs';
const r = JSON.parse(readFileSync(new URL('./reports/results.json', import.meta.url)));
console.log(JSON.stringify(r.stats));
const out = [];
const walk = (s, p = []) => {
  for (const x of s.suites ?? []) walk(x, [...p, x.title]);
  for (const sp of s.specs ?? [])
    for (const t of sp.tests) {
      const res = t.results.at(-1);
      if (res && !['passed', 'skipped'].includes(res.status))
        out.push([t.projectName, [...p, sp.title].join(' › '),
          (res.errors?.map((e) => e.message).join(' || ') || res.error?.message || res.status)
            .replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter(Boolean).slice(0, 8).join(' | ').slice(0, 700)]);
    }
};
r.suites.forEach((s) => walk(s));
for (const o of out) console.log(`\n[${o[0]}] ${o[1]}\n   ${o[2]}`);
