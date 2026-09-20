const BASE = process.env.BASE; // e.g. https://school-spike.<your-subdomain>.workers.dev
async function time(path, n = 12) {
  const ms = [];
  for (let i = 0; i < n; i++) { const t = performance.now(); const r = await fetch(BASE + path); await r.text(); ms.push(Math.round(performance.now() - t)); }
  const s = [...ms].sort((a, b) => a - b);
  return `median ${s[Math.floor(n / 2)]} ms (min ${s[0]}, max ${s[n - 1]})`;
}
console.log("no database         :", await time("/"));
console.log("4 queries, one by one:", await time("/stats"));
console.log("4 queries, one batch  :", await time("/stats-batched"));

