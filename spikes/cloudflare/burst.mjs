const BASE = process.env.BASE; // e.g. https://school-spike.<your-subdomain>.workers.dev
async function burst(logn, n) {
  const started = performance.now();
  const results = await Promise.all(Array.from({ length: n }, async () => {
    const t = performance.now();
    const r = await fetch(`${BASE}/scrypt?logn=${logn}`);
    await r.text();
    return { status: r.status, ms: performance.now() - t };
  }));
  const ok = results.filter((r) => r.status === 200).length;
  const lat = results.filter((r) => r.status === 200).map((r) => r.ms).sort((a, b) => a - b);
  const p = (q) => (lat.length ? Math.round(lat[Math.min(lat.length - 1, Math.floor(q * lat.length))]) : "-");
  const errs = {};
  results.filter((r) => r.status !== 200).forEach((r) => (errs[r.status] = (errs[r.status] ?? 0) + 1));
  console.log(`scrypt N=2^${logn}, ${n} at once: ok ${ok}/${n}  p50 ${p(0.5)}ms  p95 ${p(0.95)}ms  total ${Math.round(performance.now() - started)}ms  errors ${JSON.stringify(errs)}`);
}
await burst(14, 60);
await burst(14, 150);
await burst(15, 60);

