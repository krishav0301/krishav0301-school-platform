const { open, shot, finish, secrets, saveSecrets, BASE } = require("./lib.cjs");

const TEACHERS = [
  ["Bikash Chaudhary", "bikash.chaudhary", "+2 (Grade 11–12)", "9851000010"],
  ["Anita Mandal", "anita.mandal", "+2 (Grade 11–12)", "9851000011"],
  ["Suresh Karki", "suresh.karki", "+2 (Grade 11–12)", "9851000012"],
  ["Kamala Rai", "kamala.rai", "+2 (Grade 11–12)", ""],
  ["Puja Singh", "puja.singh", "Bachelor's", "9851000014"],
  ["Rajan Sah", "rajan.sah", "Bachelor's", "9851000015"],
];

(async () => {
  const s = await open();
  const p = s.page;
  const d = () => p.locator("dialog[open]");
  const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
  const step = async (name, fn) => {
    if (only && !only.includes(name)) return;
    try {
      await fn();
    } catch (e) {
      console.error("FAILED", name, e.message.split("\n")[0]);
      await p.screenshot({ path: `${__dirname}/err-${name}.png`, fullPage: true });
      if (await d().count()) await d().getByRole("button", { name: "Close" }).first().click().catch(() => {});
    }
  };
  const passwords = { ...(secrets().teacherPasswords ?? {}) };
  const notePassword = async (name) => {
    const box = p.locator(`text=Temporary password for ${name}`).locator('xpath=ancestor::*[.//button[normalize-space()="I have noted it"]][1]');
    await box.waitFor();
    passwords[name] = /[A-Z0-9]{4}(?:-[A-Z0-9]{4}){3}/.exec(await box.innerText())[0];
    return box;
  };
  const fillTeacher = async (fullName, user, section, phone) => {
    await d().getByLabel("Full name").fill(fullName);
    await d().getByLabel("Email").fill(`${user}@school.example`);
    if (phone) await d().getByLabel("Phone (optional)").fill(phone);
    const sel = d().getByLabel(/Home section|Section/).first();
    await sel.selectOption({ label: section });
  };

  await step("staff", async () => {
    await p.goto(BASE + "/portal/people", { waitUntil: "networkidle" });
    await p.waitForTimeout(800);
    await shot(p, "05-01-staff-empty", "Staff, as the Co-ordinator sees it: only teachers, none yet");
    await p.getByRole("button", { name: "Add a person" }).first().click();
    await p.waitForTimeout(400);
    await shot(p, "05-02-add-teacher-form", "Add a person: the role is fixed to Teacher; name, email, phone and home section", { el: "dialog[open]" });
    await d().getByRole("button", { name: "Add a person" }).click();
    await p.waitForTimeout(700);
    await shot(p, "05-03-add-teacher-empty", "Sent empty: the name and email are asked for", { el: "dialog[open]" });
    await d().getByLabel("Full name").fill("B");
    await d().getByLabel("Email").fill("bikash@");
    await d().getByRole("button", { name: "Add a person" }).click();
    await p.waitForTimeout(700);
    await shot(p, "05-04-add-teacher-invalid", "A one-letter name and an incomplete email are each explained", { el: "dialog[open]" });
    const [n, u, sec, ph] = TEACHERS[0];
    await fillTeacher(n, u, sec, ph);
    await d().getByRole("button", { name: "Add a person" }).click();
    await notePassword(n);
    await shot(p, "05-05-teacher-temporary-password", "Bikash Chaudhary added: the temporary password is shown once, to give him in person", { full: false });
    await p.getByRole("button", { name: "I have noted it" }).first().click();
    for (const [name, user, section, phone] of TEACHERS.slice(1)) {
      await p.getByRole("button", { name: "Add a person" }).first().click();
      await fillTeacher(name, user, section, phone);
      await d().getByRole("button", { name: "Add a person" }).click();
      await notePassword(name);
      await p.getByRole("button", { name: "I have noted it" }).first().click();
      await p.waitForTimeout(500);
    }
    saveSecrets({ teacherPasswords: passwords });
    await shot(p, "05-06-six-teachers", "Six teachers: four for +2 and two for Bachelor's, none signed in yet");
    await p.getByRole("button", { name: "Add a person" }).first().click();
    await fillTeacher("Anita Again", "anita.mandal", "+2 (Grade 11–12)", "");
    await d().getByRole("button", { name: "Add a person" }).click();
    await p.waitForTimeout(1200);
    await shot(p, "05-07-teacher-duplicate-email", "An email already in use is refused", { full: false });
    if (await d().count()) await d().getByRole("button", { name: "Close" }).click();
  });

  await step("staff-actions", async () => {
    await p.goto(BASE + "/portal/people", { waitUntil: "networkidle" });
    await p.waitForTimeout(800);
    await p.getByLabel("Search by name or email").fill("kamala");
    await p.waitForTimeout(400);
    await shot(p, "05-07b-staff-search", "Search narrows the list as she types: Kamala Rai", { full: false });
    await p.getByLabel("Search by name or email").fill("");
    // Switching off and a new password are in each person's panel, opened with Manage (D-106).
    await p.getByRole("button", { name: "Manage Kamala Rai" }).click();
    await d().getByRole("heading", { name: "Kamala Rai" }).waitFor();
    await shot(p, "05-07c-manage-panel", "Manage Kamala Rai: her details, a new temporary password, and Switch off", { full: false });
    await d().getByRole("button", { name: "Switch off", exact: true }).click();
    await p.waitForTimeout(1200);
    await shot(p, "05-08-teacher-switched-off", "Kamala Rai switched off: kept, marked Switched off, signed out and unable to sign in", { full: false });
    await d().getByRole("button", { name: "Switch on", exact: true }).click();
    await p.waitForTimeout(1200);
    await shot(p, "05-09-teacher-switched-on", "Kamala Rai switched on again", { full: false });
    await d().getByRole("button", { name: "Close", exact: true }).click();
    await p.waitForTimeout(800);
    await p.getByRole("button", { name: "Manage Suresh Karki" }).click();
    await d().getByRole("button", { name: "New temporary password", exact: true }).click();
    await p.waitForTimeout(800);
    await notePassword("Suresh Karki");
    await shot(p, "05-10-teacher-new-password", "A new temporary password for Suresh Karki, shown once (the old one stops working)", { full: false });
    await d().getByRole("button", { name: "I have noted it" }).click();
    await d().getByRole("button", { name: "Close", exact: true }).click();
    saveSecrets({ teacherPasswords: passwords });
  });

  await finish(s);
})();
