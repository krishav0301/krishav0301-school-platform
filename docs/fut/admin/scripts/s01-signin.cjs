const { open, shot, finish, saveSecrets, freshTotp, BASE } = require("./lib.cjs");
const EMAIL = "rajendra.shah@school.example";
const PASSWORD = "Morning-Tea-Garden-58";

(async () => {
  const s = await open({ fresh: true });
  const p = s.page;
  try {
    await p.goto(BASE + "/portal", { waitUntil: "networkidle" });
    await p.waitForSelector("text=Sign in to");
    await shot(p, "01-01-portal-redirects-to-sign-in", "Opening the portal while signed out goes to the sign-in page");

    await p.getByRole("button", { name: "Sign in" }).click();
    await shot(p, "01-02-sign-in-empty", "Sign in with nothing typed: both fields are asked for");

    await p.getByLabel("Email").fill(EMAIL);
    await p.getByLabel("Password", { exact: true }).fill("wrong-password-123");
    await p.getByRole("button", { name: "Sign in" }).click();
    await p.waitForSelector("text=is not correct");
    await shot(p, "01-03-sign-in-wrong-password", "A wrong password: a plain message that does not say which part is wrong");

    await p.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await p.getByRole("button", { name: "Show password" }).click();
    await shot(p, "01-04-sign-in-show-password", "Show password reveals what was typed before signing in");
    await p.getByRole("button", { name: "Sign in" }).click();
    await p.waitForSelector("text=Set up two-step sign-in");
    await p.waitForSelector("code");
    await shot(p, "01-05-two-step-setup", "First sign-in of a Principal: two-step sign-in must be set up (QR code and setup key)");

    const key = (await p.locator("code").first().innerText()).replace(/\s+/g, "");
    saveSecrets({ totpSecret: key });

    await p.getByRole("textbox", { name: "Code" }).fill("123456");
    await p.getByRole("button", { name: "Turn on" }).click();
    await p.waitForTimeout(800);
    await shot(p, "01-06-two-step-setup-wrong-code", "A wrong code from the app is refused");

    await p.getByRole("textbox", { name: "Code" }).fill(await freshTotp());
    await p.getByRole("button", { name: "Turn on" }).click();
    await p.waitForSelector("text=Save your recovery codes");
    const codes = await p.locator("ul code").allInnerTexts();
    saveSecrets({ recoveryCodes: codes });
    await shot(p, "01-07-recovery-codes", "Ten recovery codes are shown once (blurred here would be wise in a real school)");

    await p.getByRole("button", { name: "I have saved these codes" }).click();
    await p.waitForURL(/\/portal\/?$/);
    await p.waitForLoadState("networkidle");
    await shot(p, "01-08-first-dashboard-empty-school", "Signed in: the Principal's dashboard on a brand-new school with no data");
  } catch (e) {
    console.error(e);
    await p.screenshot({ path: __dirname + "/err.png", fullPage: true });
  }
  await finish(s);
})();
