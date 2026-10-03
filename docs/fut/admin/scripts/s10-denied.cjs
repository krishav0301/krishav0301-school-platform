// What the Principal must NOT be able to do: other roles' pages opened by address, and the server's answer to
// each forbidden action, sent with the Principal's own sign-in (cookies from the saved browser state).
const fs = require("fs");
const { open, shot, finish, secrets, BASE, SP } = require("./lib.cjs");

(async () => {
  const s = await open();
  const p = s.page;
  const y = secrets().year;
  const pages = [
    ["/portal/admissions", "10-01-admissions-queue", "The Co-ordinator's admissions queue, opened by address"],
    ["/portal/admissions/register", "10-02-register-form", "Register a student (the Accountant's), opened by address"],
    ["/portal/fees/vouchers", "10-03-vouchers", "The Accountant's voucher checks, opened by address"],
    ["/portal/results/review", "10-04-results-review", "The Co-ordinator's marks review, opened by address"],
    ["/portal/attendance/mine", "10-05-attendance-mine", "A teacher's own attendance page, opened by address"],
    ["/portal/setup/classes", "10-06-classes-read-only", "Classes: the Principal can look; adding and changing is the Co-ordinator's"],
  ];
  for (const [url, id, title] of pages) {
    try {
      await p.goto(BASE + url, { waitUntil: "networkidle" });
      await p.waitForTimeout(1200);
      await shot(p, id, title, { full: false });
    } catch (e) {
      console.error("FAILED", url, e.message.split("\n")[0]);
    }
  }

  // The server's answers, with the Principal's real cookies.
  const cookies = (await s.context.cookies()).filter((c) => c.name.startsWith("__Host-")).map((c) => `${c.name}=${c.value}`).join("; ");
  const call = async (method, path, body) => {
    const r = await fetch(BASE + path, { method, headers: { Cookie: cookies, Origin: BASE, "Sec-Fetch-Site": "same-origin", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: (await r.text()).slice(0, 160) };
  };
  const someTeacher = y.teacher["anita.mandal"];
  const g11 = y.g11;
  const enr = (await call("GET", `/api/fees/dues?classId=${g11}`)).body;
  const dues = JSON.parse((await (await fetch(BASE + `/api/fees/dues?classId=${g11}`, { headers: { Cookie: cookies } })).text()));
  const anEnrollment = dues.students[0].enrollmentId;
  const checks = [
    ["Create a teacher (the Co-ordinator's)", "POST", "/api/teachers", { fullName: "No One", email: "no.one@school.example", homeSectionKey: "x" }],
    ["Create another Admin (Support only)", "POST", "/api/staff", { fullName: "Second Admin", email: "second.admin@school.example", role: "admin" }],
    ["Switch off a teacher (the Co-ordinator's)", "PATCH", `/api/staff/${someTeacher}`, { active: false }],
    ["New temporary password for a teacher", "POST", `/api/staff/${someTeacher}/temporary-password`, {}],
    ["Make an academic year (the Co-ordinator's)", "POST", "/api/academics/years", { bsYear: 2084, startDate: "2027-04-14", endDate: "2028-04-12" }],
    ["Make a class (the Co-ordinator's)", "POST", "/api/academics/classes", { yearId: y.yearId, levelId: "0".repeat(32), label: "B" }],
    ["Register a walk-in student", "POST", "/api/admissions/walk-ins", { firstName: "A", lastName: "B" }],
    ["Mark a class register", "PUT", `/api/attendance/classes/${g11}/today`, { absent: [] }],
    ["Record a cash payment (the Accountant's)", "POST", "/api/fees/payments/cash", { enrollmentId: anEnrollment, amountPaisa: 100, idempotencyKey: "a".repeat(32) }],
    ["Propose a discount (the Accountant's)", "POST", `/api/fees/enrollments/${anEnrollment}/discounts`, { percent: 5, reason: "sibling" }],
    ["Publish a class's results (the Co-ordinator's)", "POST", `/api/results/classes/${g11}/publish`, { terminalId: y.terminals[1] }],
    ["Enter marks (a teacher's)", "PUT", `/api/results/classes/${g11}/subjects/${y.offerings.g11.Physics.id}/terminals/${y.terminals[2]}`, { marks: [] }],
  ];
  const results = [];
  for (const [what, method, path, body] of checks) results.push({ what, method, path: path.replace(/[0-9a-f]{32}/g, "{id}"), ...(await call(method, path, body)) });

  // Self-approval: the Principal's own draft, sent for approval, cannot be approved by the Principal.
  const draft = await call("POST", "/api/content", { kind: "notice", title: "Own request test", body: "Sent by the Principal to the approvals inbox.", publishOn: new Date(Date.now() + 345 * 60_000).toISOString().slice(0, 10) });
  const draftId = JSON.parse(draft.body).id;
  const req = await call("POST", "/api/approvals", { kind: "website_content", subjectId: draftId });
  const reqId = JSON.parse(req.body).id;
  results.push({ what: "Send own draft for approval", method: "POST", path: "/api/approvals", ...req });
  results.push({ what: "Approve own request", method: "POST", path: "/api/approvals/{id}/approve", ...(await call("POST", `/api/approvals/${reqId}/approve`)) });
  await p.goto(BASE + "/portal/approvals", { waitUntil: "networkidle" });
  await p.waitForTimeout(1200);
  await shot(p, "10-07-own-request", "The Principal's own request in the inbox, marked \"Your request\"; it is not counted as waiting for them", { full: false });
  await p.getByRole("button", { name: /^Review Website content: Notice: .Own request test/ }).click();
  await p.waitForTimeout(1500);
  await shot(p, "10-08-own-request-panel", "Opened: no Approve; it says another Principal or Support must decide it, and offers Take back request (F-13 fixed)", { full: false });
  await p.locator("dialog[open]").getByRole("button", { name: "Take back request" }).click();
  await p.waitForTimeout(1500);
  await shot(p, "10-08a-own-request-taken-back", "Taken back: the request is withdrawn and the draft is the Principal's again", { full: false });
  await p.locator("dialog[open]").getByRole("button", { name: "Done" }).click();
  results.push({ what: "Withdraw own request (already taken back on screen)", method: "POST", path: "/api/approvals/{id}/withdraw", ...(await call("POST", `/api/approvals/${reqId}/withdraw`)) });

  fs.writeFileSync(`${SP}/denied.json`, JSON.stringify(results, null, 2));
  for (const r of results) console.log(r.status, r.what, "|", r.body.slice(0, 90));
  await finish(s);
})();
