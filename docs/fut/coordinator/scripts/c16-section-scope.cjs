// A Co-ordinator whose access reaches the Bachelor's section only (Hari Prasad Yadav): what he sees, and what the
// server answers when he reaches for +2.
const fs = require("fs");
const { open, shot, finish, secrets, saveSecrets, BASE, SP } = require("./lib.cjs");

const PASSWORD = "Copper-River-Evening-35";

(async () => {
  const s = await open({ fresh: true });
  const p = s.page;
  const hari = secrets().staff.hari;
  const ids = secrets().classIds;
  const step = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      console.error("FAILED", name, e.message.split("\n")[0]);
      await p.screenshot({ path: `${__dirname}/err-${name}.png`, fullPage: true });
    }
  };
  const go = async (url) => {
    await p.goto(BASE + url, { waitUntil: "networkidle" });
    await p.waitForTimeout(1300);
  };

  await step("signin", async () => {
    await go("/sign-in");
    await p.getByLabel("Email").fill(hari.email);
    await p.getByLabel("Password", { exact: true }).fill(secrets().hariPassword ?? hari.temporaryPassword);
    await p.getByRole("button", { name: "Sign in" }).click();
    await p.waitForTimeout(1500);
    if (await p.getByLabel("New password").count()) {
      await p.getByLabel("New password").fill(PASSWORD);
      await p.getByRole("button", { name: "Save password and continue" }).click();
      saveSecrets({ hariPassword: PASSWORD });
    }
    await p.waitForURL(/\/portal/);
    await p.waitForTimeout(1500);
    await shot(p, "16-01-hari-dashboard", "Hari Prasad Yadav, a Co-ordinator for Bachelor's only: his dashboard counts only Bachelor's classes");
  });
  for (const [url, id, title] of [
    ["/portal/attendance", "16-02-hari-attendance", "Attendance: only BBS Year 1"],
    ["/portal/results", "16-03-hari-results", "Results review: only BBS Year 1"],
    ["/portal/admissions", "16-04-hari-queue", "Admissions queue: only the Bachelor's application (Rajesh Yadav)"],
    ["/portal/people", "16-05-hari-staff", "Staff: only the Bachelor's teachers"],
    ["/portal/setup/classes", "16-06-hari-classes", "Classes: what Hari sees of the year's classes"],
  ])
    await step(id, async () => {
      await go(url);
      await shot(p, id, title);
    });
  await step("walkin-levels", async () => {
    await go("/portal/admissions/register");
    const opts = await p.getByLabel("Applying for").locator("option").allInnerTexts();
    console.log("walk-in levels:", opts.join(" | "));
    await shot(p, "16-07-hari-walkin", `Walk-in: Applying for offers only his section's ${opts.length - 1} levels (F-11 fixed)`, { full: false });
  });
  await step("server", async () => {
    const cookies = (await s.context.cookies()).filter((c) => c.name.startsWith("__Host-")).map((c) => `${c.name}=${c.value}`).join("; ");
    const call = async (method, path, body) => {
      const r = await fetch(BASE + path, { method, headers: { Cookie: cookies, Origin: BASE, "Sec-Fetch-Site": "same-origin", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, body: (await r.text()).slice(0, 160) };
    };
    const first = secrets().terminals["First terminal"];
    const checks = [
      ["See Grade 11 A's register (+2)", "GET", `/api/attendance/classes/${ids.g11a}/day`],
      ["See BBS Year 1's register (his section)", "GET", `/api/attendance/classes/${ids.bbs1}/day`],
      ["Read Grade 11 A's class sheet (+2)", "GET", `/api/results/classes/${ids.g11a}/terminals/${first}/sheet`],
      ["Read BBS Year 1's class sheet (his section)", "GET", `/api/results/classes/${ids.bbs1}/terminals/${first}/sheet`],
      ["Set Grade 11 A's electives (+2)", "GET", `/api/results/classes/${ids.g11a}/electives`],
      ["Publish Grade 11 A's second terminal (+2)", "POST", `/api/results/classes/${ids.g11a}/publish`, { terminalId: secrets().terminals["Second terminal"] }],
      ["Search students (only Bachelor's should come back)", "GET", "/api/students?q=a"],
    ];
    const results = [];
    for (const [what, method, path, body] of checks) {
      const r = await call(method, path, body);
      if (what.startsWith("Search")) r.body = JSON.parse(r.body.length < 160 ? r.body : (await (await fetch(BASE + path, { headers: { Cookie: cookies } })).text())).students?.map((x) => `${x.firstName} ${x.lastName} (${x.className})`).join(", ") ?? r.body;
      results.push({ what, method, path: path.replace(/[0-9a-f]{32}/g, "{id}"), ...r });
    }
    fs.writeFileSync(`${SP}/scope.json`, JSON.stringify(results, null, 2));
    for (const r of results) console.log(r.status, r.what, "|", String(r.body).slice(0, 120));
  });
  await finish(s, false);
})();
