// Polls URLs every 100 ms until killed, and prints a summary on SIGTERM:
// every non-200 (with its time and body) and the longest gap between two 200s.
// Two clients per URL: one opens a new connection for every request, the
// other keeps one alive, as a browser does. Usage: node poll.mjs URL...
import http from 'node:http';

const urls = process.argv.slice(2);
const stats = new Map();
const t0 = Date.now();

function get(url, agent) {
  return new Promise((resolve) => {
    const req = http.get(url, { agent, timeout: 10_000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ code: res.statusCode, body }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ code: 0, body: e.code || e.message }));
  });
}

async function loop(url, agent, name) {
  const key = `${name} ${url}`;
  const s = { n: 0, bad: [], lastOk: Date.now(), maxGap: 0, maxMs: 0, slowest: '', bodies: new Set() };
  stats.set(key, s);
  for (;;) {
    const started = Date.now();
    const r = await get(url, agent);
    const ms = Date.now() - started;
    if (ms > s.maxMs) { s.maxMs = ms; s.slowest = `${((started - t0) / 1000).toFixed(1)}s (epoch ${(started / 1000).toFixed(2)})`; }
    s.n += 1;
    if (r.code === 200) {
      s.maxGap = Math.max(s.maxGap, Date.now() - s.lastOk);
      s.lastOk = Date.now();
      s.bodies.add(r.body.replace(/ pid \d+/, ''));
    } else {
      s.bad.push(`${((started - t0) / 1000).toFixed(1)}s ${r.code} ${r.body.slice(0, 60).replace(/\s+/g, ' ')}`);
    }
    await new Promise((res) => setTimeout(res, Math.max(0, 100 - (Date.now() - started))));
  }
}

for (const u of urls) {
  // One agent per loop, so a slow URL never queues another URL's requests.
  loop(u, new http.Agent({ keepAlive: false }), 'new-conn');
  loop(u, new http.Agent({ keepAlive: true, maxSockets: 1 }), 'keepalive');
}
process.on('SIGTERM', () => {
  for (const [k, s] of stats) {
    console.log(`${k}: ${s.n} requests, ${s.bad.length} not 200, longest gap between 200s ${s.maxGap} ms, slowest ${s.maxMs} ms at ${s.slowest}, saw [${[...s.bodies].join(' | ')}]`);
    for (const b of s.bad.slice(0, 20)) console.log(`   ${b}`);
  }
  process.exit(0);
});
