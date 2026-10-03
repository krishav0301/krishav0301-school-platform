const { open, shot, finish, secrets, saveSecrets, BASE } = require("./lib.cjs");
const PASSWORD = "Saffron-Hill-Morning-62";

(async () => {
  const s = await open({ fresh: true });
  const p = s.page;
  const sita = secrets().staff.sita;
  try {
    await p.goto(BASE + "/sign-in", { waitUntil: "networkidle" });
    await shot(p, "01-01-sign-in", "The sign-in page");
    await p.getByLabel("Email").fill(sita.email);
    await p.getByLabel("Password", { exact: true }).fill("not-the-password-1");
    await p.getByRole("button", { name: "Sign in" }).click();
    await p.waitForSelector("text=is not correct");
    await shot(p, "01-02-wrong-password", "A wrong password is refused without saying which part is wrong", { full: false });
    await p.getByLabel("Password", { exact: true }).fill(sita.temporaryPassword);
    await p.getByRole("button", { name: "Sign in" }).click();
    await p.waitForSelector("text=Choose your own password");
    await shot(p, "01-03-choose-own-password", "First sign-in with the temporary password from the Principal: she must choose her own password", { full: false });
    const field = p.getByLabel("New password");
    const save = p.getByRole("button", { name: "Save password and continue" });
    for (const [id, value, title] of [
      ["01-04-same-as-temporary", sita.temporaryPassword, "The temporary password itself is refused"],
      ["01-05-too-short", "short", "Under 10 characters is refused"],
      ["01-06-common", "password123", "A common password is refused"],
      ["01-07-email-name", "sita.sharma-2083", "A password containing her email name is refused"],
      ["01-08-school-name", "royalsoftech-lahan", "A password containing the school's name is refused"],
    ]) {
      await field.fill(value);
      await save.click();
      await p.waitForTimeout(1200);
      await shot(p, id, title, { full: false });
    }
    await field.fill(PASSWORD);
    await save.click();
    await p.waitForURL(/\/portal/);
    await p.waitForLoadState("networkidle");
    await p.waitForTimeout(1500);
    await shot(p, "01-09-dashboard-first", "Signed in: the Co-ordinator's dashboard on a school that has programmes but no year, classes or teachers yet");
    saveSecrets({ sitaPassword: PASSWORD });
  } catch (e) {
    console.error(e);
    await p.screenshot({ path: __dirname + "/err.png", fullPage: true });
  }
  await finish(s);
})();
