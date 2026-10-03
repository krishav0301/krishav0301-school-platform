// Precondition P5: the Principal decides the Co-ordinator's requests: approves the notice, declines the exhibition.
const { admin } = require("./people-api.cjs");
(async () => {
  const a = admin();
  const { requests } = await a("GET", "/api/approvals");
  for (const r of requests) {
    const text = JSON.stringify(r);
    if (text.includes("Parents' meeting")) await a("POST", `/api/approvals/${r.id}/approve`);
    if (text.includes("Science exhibition")) await a("POST", `/api/approvals/${r.id}/decline`, { reason: "Please add the date and the time before it goes on the website." });
  }
  console.log("decided", requests.length);
})().catch((e) => { console.error(e); process.exit(1); });
