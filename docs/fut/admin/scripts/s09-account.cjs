const { open, shot, finish, freshTotp, secrets, saveSecrets, BASE } = require("./lib.cjs");

const EMAIL = "rajendra.shah@school.example";
const P1 = "Morning-Tea-Garden-58";
const P2 = "Lotus-Pond-Evening-77";
const P3 = "River-Bank-Sunrise-41";

(async () => {
  let s = await open();
  let p = s.page;
  const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
  const step = async (name, fn) => {
    if (only && !only.includes(name)) return;
    try {
      await fn();
    } catch (e) {
      console.error("FAILED", name, e.message.split("\n")[0]);
      await p.screenshot({ path: `${__dirname}/err-${name}.png` });
    }
  };
  const signInForm = async (password) => {
    await p.getByLabel("Email").fill(EMAIL);
    await p.getByLabel("Password", { exact: true }).fill(password);
    await p.getByRole("button", { name: "Sign in" }).click();
  };

  await step("profile", async () => {
    await p.goto(BASE + "/portal/settings", { waitUntil: "networkidle" });
    await p.waitForTimeout(800);
    await shot(p, "09-01-settings", "Settings: your profile, change your password, sign out");
    await p.getByLabel("Full name").fill("");
    await p.getByRole("button", { name: "Save profile" }).click();
    await p.waitForTimeout(800);
    await shot(p, "09-02-profile-name-required", "Saving the profile with no name is refused", { full: false });
    await p.getByLabel("Full name").fill("Rajendra Prasad Shah");
    await p.getByLabel("Phone (optional)").fill("9852000001");
    await p.getByRole("button", { name: "Save profile" }).click();
    await p.waitForTimeout(1200);
    await shot(p, "09-03-profile-saved", "Name and phone saved", { full: false });
  });

  await step("password", async () => {
    await p.goto(BASE + "/portal/settings", { waitUntil: "networkidle" });
    const cur = p.getByLabel("Current password");
    const neu = p.getByLabel("New password");
    const submit = p.getByRole("button", { name: "Change password" });
    await cur.fill("not-my-password-1");
    await neu.fill(P2);
    await submit.click();
    await p.waitForTimeout(1200);
    await shot(p, "09-04-password-wrong-current", "Change password with a wrong current password is refused", { full: false });
    await cur.fill(P1);
    await neu.fill("password123");
    await submit.click();
    await p.waitForTimeout(1200);
    await shot(p, "09-05-password-common", "A common new password is refused", { full: false });
    await neu.fill("RoyalSoftech-2083");
    await submit.click();
    await p.waitForTimeout(1200);
    await shot(p, "09-06-password-school-name", "A new password containing the school's name is refused", { full: false });
    await neu.fill("short");
    await submit.click();
    await p.waitForTimeout(1200);
    await shot(p, "09-07-password-too-short", "A new password under 10 characters is refused", { full: false });
    await neu.fill(P2);
    await submit.click();
    await p.waitForTimeout(1500);
    await shot(p, "09-08-password-changed", "The password is changed", { full: false });
    saveSecrets({ password: P2 });
  });

  await step("signout", async () => {
    await p.goto(BASE + "/portal/settings", { waitUntil: "networkidle" });
    await p.getByRole("button", { name: "Sign out" }).click();
    await p.waitForTimeout(1500);
    await shot(p, "09-09-signed-out", "Signed out: back on the sign-in page");
    await p.goto(BASE + "/portal/fees", { waitUntil: "networkidle" });
    await p.waitForTimeout(1000);
    await shot(p, "09-10-portal-after-sign-out", "Opening a portal page after signing out asks to sign in again", { full: false });
    await signInForm(P1);
    await p.waitForTimeout(1200);
    await shot(p, "09-11-old-password-refused", "The old password no longer works", { full: false });
    await signInForm(P2);
    await p.getByRole("textbox", { name: "Code" }).waitFor();
    await shot(p, "09-12-code-step", "The new password works; the authenticator code is asked for", { full: false });
    await p.getByRole("textbox", { name: "Code" }).fill("000000");
    await p.getByRole("button", { name: "Verify" }).click();
    await p.waitForTimeout(1200);
    await shot(p, "09-13-code-wrong", "A wrong code is refused", { full: false });
    await p.getByRole("button", { name: "Use a recovery code instead" }).click();
    const code = secrets().recoveryCodes[0];
    await p.getByRole("textbox", { name: "Recovery code" }).fill(code);
    await shot(p, "09-14-recovery-code", "Signing in with one of the saved recovery codes instead", { full: false });
    await p.getByRole("button", { name: "Verify" }).click();
    await p.waitForURL(/\/portal/);
    await p.waitForTimeout(1200);
    await shot(p, "09-15-signed-in-with-recovery", "Signed in with a recovery code; that code is now used up", { full: false });
    saveSecrets({ recoveryCodes: secrets().recoveryCodes.slice(1), usedRecoveryCode: code });
  });

  await step("recovery-reuse", async () => {
    await finish(s);
    s = await open({ fresh: true });
    p = s.page;
    await p.goto(BASE + "/sign-in", { waitUntil: "networkidle" });
    await signInForm(P2);
    await p.getByRole("button", { name: "Use a recovery code instead" }).click();
    await p.getByRole("textbox", { name: "Recovery code" }).fill(secrets().usedRecoveryCode);
    await p.getByRole("button", { name: "Verify" }).click();
    await p.waitForTimeout(1200);
    await shot(p, "09-16-recovery-code-reused", "The same recovery code a second time is refused: each works once", { full: false });
  });

  await step("reset", async () => {
    await finish(s, false);
    s = await open({ fresh: true });
    p = s.page;
    await p.goto(BASE + "/sign-in", { waitUntil: "networkidle" });
    await p.getByRole("link", { name: "Forgot your password?" }).click();
    await p.waitForTimeout(800);
    await shot(p, "09-17-forgot-password", "Forgot your password: ask for a reset link", { full: false });
    await p.getByLabel("Email").fill(EMAIL);
    await p.getByRole("button", { name: "Send reset link" }).click();
    await p.waitForTimeout(1500);
    await shot(p, "09-18-reset-sent", "The same answer whether or not the email has an account, so nobody can probe for accounts", { full: false });
    // Read the email in the test mailbox (signed in on another browser).
    const m = await open();
    await m.page.goto(BASE + "/portal/mailbox", { waitUntil: "networkidle" });
    await m.page.waitForTimeout(1200);
    await shot(m.page, "09-19-mailbox-reset-email", "The test mailbox (only where email is not really sent) shows the reset email", { full: false });
    const link = (await m.page.locator("a[href*='reset-password']").first().getAttribute("href")).split(/\s/)[0];
    await finish(m);
    await p.goto(link.startsWith("http") ? link : BASE + link, { waitUntil: "networkidle" });
    await p.waitForTimeout(1000);
    await shot(p, "09-20-reset-new-password", "The reset link opens Choose a new password", { full: false });
    await p.getByLabel("New password").fill("royalsoftech-lahan");
    await p.getByRole("button", { name: "Change password" }).click();
    await p.waitForTimeout(1200);
    await shot(p, "09-21-reset-weak", "A new password with the school's name in it is refused here too", { full: false });
    await p.getByLabel("New password").fill(P3);
    await p.getByRole("button", { name: "Change password" }).click();
    await p.waitForTimeout(1500);
    await shot(p, "09-22-reset-done", "Password changed; sign in with the new one", { full: false });
    saveSecrets({ password: P3 });
    saveSecrets({ resetLink: link });
  });

  await step("reset-reuse", async () => {
    const r = await open({ fresh: true });
    await r.page.goto(secrets().resetLink, { waitUntil: "networkidle" });
    await r.page.waitForTimeout(800);
    await r.page.getByLabel("New password").fill("Another-Fresh-Pass-99");
    await r.page.getByRole("button", { name: "Change password" }).click();
    await r.page.waitForTimeout(1500);
    await shot(r.page, "09-23-reset-link-reused", "The same reset link opened again: refused, the link expired or was already used", { full: false });
    await finish(r, false);
  });

  await step("lockout", async () => {
    await p.goto(BASE + "/sign-in", { waitUntil: "networkidle" });
    for (let i = 0; i < 6; i++) {
      await p.getByLabel("Email").fill("nobody.here@school.example");
      await p.getByLabel("Password", { exact: true }).fill(`wrong-guess-${i}-x`);
      await p.getByRole("button", { name: "Sign in" }).click();
      await p.waitForTimeout(900);
    }
    await shot(p, "09-24-lockout", "Six wrong tries for one email (even an unknown one): Too many attempts, wait a few minutes", { full: false });
  });

  await step("back-in", async () => {
    await p.goto(BASE + "/sign-in", { waitUntil: "networkidle" });
    await signInForm(P3);
    await p.getByRole("textbox", { name: "Code" }).fill(await freshTotp());
    await p.getByRole("button", { name: "Verify" }).click();
    await p.waitForURL(/\/portal/);
    await p.waitForTimeout(1500);
    await shot(p, "09-25-signed-in-new-password", "Signed in with the reset password and the authenticator code");
  });

  await finish(s);
})();
