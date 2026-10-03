const fs = require("fs");
const { open, shot, finish, secrets, saveSecrets, BASE, SP } = require("./lib.cjs");

const NEW = "Juniper-Valley-Dawn-47";

(async () => {
  let s = await open();
  let p = s.page;
  const step = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      console.error("FAILED", name, e.message.split("\n")[0]);
      await p.screenshot({ path: `${__dirname}/err-${name}.png`, fullPage: true });
    }
  };

  await step("settings", async () => {
    await p.goto(BASE + "/portal/settings", { waitUntil: "networkidle" });
    await p.waitForTimeout(800);
    await shot(p, "15-01-settings", "Settings: her profile, password and sign out");
    await p.getByLabel("Phone (optional)").fill("9842000099");
    await p.getByRole("button", { name: "Save profile" }).click();
    await p.waitForTimeout(1200);
    await shot(p, "15-02-profile-saved", "Her phone corrected and saved", { full: false });
    await p.getByLabel("Current password").fill(secrets().sitaPassword);
    await p.getByLabel("New password").fill(NEW);
    await p.getByRole("button", { name: "Change password" }).click();
    await p.waitForTimeout(1500);
    await shot(p, "15-03-password-changed", "Password changed (other devices are signed out)", { full: false });
    saveSecrets({ sitaPassword: NEW });
  });

  // Other roles' pages, opened by address.
  const pages = [
    ["/portal/fees", "15-04-fees-page", "Fees (the Accountant's), opened by address: the Co-ordinator has no Fees view"],
    ["/portal/approvals", "15-05-approvals-page", "The Principal's Approvals inbox, opened by address"],
    ["/portal/setup/programmes", "15-06-programmes-read-only", "Programmes: the Co-ordinator can look; sections and programmes are the Principal's"],
    ["/portal/reports", "15-07-reports-page", "The Principal's Reports, opened by address"],
    ["/portal/attendance/mine", "15-08-attendance-mine", "A teacher's own attendance page, opened by address"],
  ];
  for (const [url, id, title] of pages)
    await step(id, async () => {
      await p.goto(BASE + url, { waitUntil: "networkidle" });
      await p.waitForTimeout(1300);
      await shot(p, id, title, { full: false });
    });

  // The server's answers, with her own signed-in cookies.
  await step("server", async () => {
    const cookies = (await s.context.cookies()).filter((c) => c.name.startsWith("__Host-")).map((c) => `${c.name}=${c.value}`).join("; ");
    const call = async (method, path, body) => {
      const r = await fetch(BASE + path, { method, headers: { Cookie: cookies, Origin: BASE, "Sec-Fetch-Site": "same-origin", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, body: (await r.text()).slice(0, 160) };
    };
    const ids = secrets().classIds;
    const sections = secrets().sections;
    const staff = secrets().staff;
    const dues = await call("GET", `/api/fees/dues?classId=${ids.g11a}`);
    const checks = [
      ["See the dues list (fees)", "GET", `/api/fees/dues?classId=${ids.g11a}`],
      ["Create an Accountant", "POST", "/api/staff", { fullName: "No One", email: "no.one@school.example", role: "accountant" }],
      ["Switch off a Co-ordinator (Hari)", "PATCH", `/api/staff/${staff.hari.id}`, { active: false }],
      ["Change a Co-ordinator's access", "PATCH", `/api/staff/${staff.hari.id}/access`, { sectionKeys: [] }],
      ["Add a section", "POST", "/api/academics/sections", { name: "Primary" }],
      ["Publish website content directly", "POST", "/api/content/00000000000000000000000000000000/publish"],
      ["Decide an approval request", "GET", "/api/approvals"],
      ["Mark a class register", "PUT", `/api/attendance/classes/${ids.g11a}/today`, { absent: [] }],
      ["Enter marks", "PUT", `/api/results/classes/${ids.g11a}/subjects/00000000000000000000000000000000/terminals/${secrets().terminals["Second terminal"]}`, { marks: [] }],
      ["Read the Principal's dashboard", "GET", "/api/dashboard/overview"],
      ["Read the test mailbox", "GET", "/api/dev/mailbox"],
      ["Register a student for the queue (the Accountant's)", "POST", "/api/admissions/register", { firstName: "A", lastName: "B" }],
    ];
    const results = [];
    for (const [what, method, path, body] of checks) results.push({ what, method, path: path.replace(/[0-9a-f]{32}/g, "{id}").replace(/classId=[^&]*/, "classId={id}"), ...(await call(method, path, body)) });
    fs.writeFileSync(`${SP}/denied.json`, JSON.stringify(results, null, 2));
    for (const r of results) console.log(r.status, r.what);
  });

  await step("signout", async () => {
    await p.goto(BASE + "/portal/settings", { waitUntil: "networkidle" });
    await p.getByRole("button", { name: "Sign out" }).click();
    await p.waitForTimeout(1500);
    await shot(p, "15-09-signed-out", "Signed out", { full: false });
    await p.getByLabel("Email").fill(secrets().staff.sita.email);
    await p.getByLabel("Password", { exact: true }).fill(NEW);
    await p.getByRole("button", { name: "Sign in" }).click();
    await p.waitForURL(/\/portal/);
    await p.waitForTimeout(1500);
    await shot(p, "15-10-signed-in-again", "Signed in again with the new password: no second step for a Co-ordinator (only the Principal and Support use an authenticator app)");
  });

  await finish(s);
})();
