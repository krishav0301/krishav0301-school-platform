const BASE = process.env.BASE; // e.g. https://school-spike.<your-subdomain>.workers.dev
const get = async (path) => {
  const r = await fetch(BASE + path);
  let body; try { body = await r.json(); } catch { body = null; }
  return { status: r.status, body };
};

// Reset state so the run is repeatable.
console.log("seed:", (await get("/seed?n=10")).body);

// 1. Ten approvals, each raced by 8 actors at once (alice is the requester and must never win).
const actors = ["alice", "bob", "carol", "dave", "erin", "frank", "gina", "hank"];
let wrongWinners = 0, zeroWinners = 0, multiWinners = 0, errors = 0;
for (let id = 1; id <= 10; id++) {
  const results = await Promise.all(actors.map((a) => get(`/approve?id=${id}&actor=${a}`)));
  errors += results.filter((r) => r.status !== 200).length;
  const winners = results.filter((r) => r.body?.won);
  if (winners.length === 0) zeroWinners++;
  if (winners.length > 1) multiWinners++;
  if (winners.some((w) => w.body.actor === "alice")) wrongWinners++;
}
console.log(`approvals: 10 raced x 8 actors -> multiple winners: ${multiWinners}, no winner: ${zeroWinners}, requester won: ${wrongWinners}, http errors: ${errors}`);

// 2. 60 valid payments and 15 invalid ones (must roll back) all at once.
const jobs = [];
for (let i = 0; i < 60; i++) jobs.push(get("/pay?amount=5000"));
for (let i = 0; i < 15; i++) jobs.push(get("/pay?amount=-5"));
const pays = await Promise.all(jobs);
const ok = pays.filter((p) => p.body?.ok).length;
const rejected = pays.filter((p) => p.body?.ok === false).length;
const other = pays.length - ok - rejected;
console.log(`payments: ok ${ok}, rejected ${rejected}, other/http errors ${other}`);

// 3. Result checks.
console.log("stats:", JSON.stringify((await get("/stats")).body));
console.log("tamper:", JSON.stringify((await get("/tamper")).body));

