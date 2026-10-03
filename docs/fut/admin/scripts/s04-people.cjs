const { open, shot, finish, saveSecrets, BASE } = require("./lib.cjs");

(async () => {
  const s = await open();
  const p = s.page;
  const d = () => p.locator("dialog[open]");
  const passwords = {};
  async function add({ role, name, email, phone, sections, shots, sectionShots }) {
    await p.getByRole("button", { name: "Add a person" }).first().click();
    if (shots) await shot(p, "04-03-add-step-role", "Add a person, step 1 Role: only Co-ordinator or Accountant; teachers are added by a Co-ordinator", { el: "dialog[open]" });
    if (shots) {
      await d().getByRole("button", { name: "Next" }).click();
      await shot(p, "04-04-add-role-required", "Next without a role: Choose a role", { el: "dialog[open]" });
    }
    await d().locator("label", { hasText: role === "coordinator" ? "Manage academic areas" : "Manage fees" }).click();
    await d().getByRole("button", { name: "Next" }).click();
    if (shots) {
      await d().getByLabel("Full name").fill("H");
      await d().getByLabel("Email").fill("not-an-email");
      await d().getByLabel(/Phone/).fill("12");
      await d().getByRole("button", { name: "Next" }).click();
      await shot(p, "04-05-add-details-invalid", "Step 2 Details: a one-letter name, a bad email and a too-short phone are each explained", { el: "dialog[open]" });
    }
    await d().getByLabel("Full name").fill(name);
    await d().getByLabel("Email").fill(email);
    await d().getByLabel(/Phone/).fill(phone ?? "");
    if (shots) await shot(p, "04-06-add-details-filled", "Step 2 Details filled in", { el: "dialog[open]" });
    await d().getByRole("button", { name: "Next" }).click();
    if (sections) {
      await d().getByText("Selected sections").click();
      if (sectionShots) {
        await d().getByRole("button", { name: "Next" }).click();
        await shot(p, "04-07-add-access-none-chosen", "Step 3 Access: Selected sections with none ticked is refused", { el: "dialog[open]" });
      }
      for (const sec of sections) await d().locator("label", { hasText: sec }).click();
      if (sectionShots) await shot(p, "04-08b-add-access-sections", "Step 3 Access: only the sections chosen (the switched-off Master's Degrees is not offered)", { el: "dialog[open]" });
    } else if (shots) await shot(p, "04-08a-add-access-whole", "Step 3 Access: the whole school", { el: "dialog[open]" });
    await d().getByRole("button", { name: "Next" }).click();
    if (shots) await shot(p, "04-09-add-review", "Step 4 Review: everything once more before the account is made", { el: "dialog[open]" });
    await d().getByRole("button", { name: "Create account" }).click();
    await p.waitForSelector(`text=Temporary password for ${name}`);
    if (shots) await shot(p, "04-10-temporary-password", "The temporary password is shown once, to give to the person; they must change it at first sign-in", { el: "dialog[open]" });
    passwords[email] = (await d().locator("code").first().innerText().catch(() => "")).trim();
    await d().getByRole("button", { name: "I have noted it" }).click();
    await p.waitForSelector(`text=${name}`);
  }
  try {
    await p.goto(BASE + "/portal/people", { waitUntil: "networkidle" });
    await p.waitForSelector("text=No administrative staff yet");
    await shot(p, "04-01-people-empty", "People & Access on a new school: counts at zero, How access works, no staff yet");
    await p.getByRole("button", { name: "Learn more" }).click().catch(() => {});
    await shot(p, "04-02-how-access-works", "How access works, opened: who gives access to whom");

    await add({ role: "coordinator", name: "Sita Sharma", email: "sita.sharma@school.example", phone: "9842000001", shots: true });
    await add({ role: "coordinator", name: "Hari Prasad Yadav", email: "hari.yadav@school.example", phone: "9842000002", sections: ["Bachelor's"], sectionShots: true });
    await add({ role: "accountant", name: "Gita Thapa", email: "gita.thapa@school.example", phone: "9842000003" });
    await add({ role: "accountant", name: "Ramesh Shrestha", email: "ramesh.shrestha@school.example", phone: "9842000004", sections: ["+2 (Grade 11–12)"] });
    await p.waitForTimeout(600);
    await shot(p, "04-11-four-staff", "Four staff: two Co-ordinators and two Accountants, whole school or one section each");

    // Duplicate email.
    await p.getByRole("button", { name: "Add a person" }).first().click();
    await d().locator("label", { hasText: "Manage fees" }).click();
    await d().getByRole("button", { name: "Next" }).click();
    await d().getByLabel("Full name").fill("Gita Duplicate");
    await d().getByLabel("Email").fill("gita.thapa@school.example");
    await d().getByRole("button", { name: "Next" }).click();
    await d().getByRole("button", { name: "Next" }).click();
    await d().getByRole("button", { name: "Create account" }).click();
    await p.waitForTimeout(1200);
    await shot(p, "04-12-duplicate-email", "An email already in use is refused, and nothing typed is lost", { el: "dialog[open]" });
    await d().getByRole("button", { name: "Cancel" }).click().catch(async () => d().getByRole("button", { name: "Close" }).click());

    // Manage access.
    await p.getByRole("button", { name: "Manage access for Hari Prasad Yadav" }).click();
    await shot(p, "04-13-manage-access", "Manage access: the person, role, account, sign-in, where their access reaches, and what the role can do", { el: "dialog[open]" });
    await d().locator("label", { hasText: "+2 (Grade 11–12)" }).click();
    await shot(p, "04-14-manage-access-changed", "Adding +2 to Hari's sections: Save access is now available", { el: "dialog[open]" });
    await d().getByRole("button", { name: "Save access" }).click();
    await p.waitForSelector("text=Access saved for Hari Prasad Yadav.");
    await shot(p, "04-15-access-saved", "Access saved: Hari now reaches +2 and Bachelor's");

    await p.getByRole("button", { name: "Manage access for Ramesh Shrestha" }).click();
    await d().getByRole("button", { name: "Switch off" }).click();
    await p.waitForTimeout(1200);
    await shot(p, "04-16-switched-off", "Ramesh is switched off: kept, marked Inactive, cannot sign in; nothing is deleted");

    saveSecrets({ staffPasswords: passwords });
  } catch (e) {
    console.error(e);
    await p.screenshot({ path: __dirname + "/err.png", fullPage: true });
  }
  await finish(s);
})();
