// PART=1: drafts, Publish tried, sent for approval, one withdrawn. PART=2 (after the Principal decides, P5): outcomes.
const { open, shot, finish, BASE } = require("./lib.cjs");

(async () => {
  const s = await open();
  const p = s.page;
  const d = () => p.locator("dialog[open]");
  const part = process.env.PART ?? "1";
  const step = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      console.error("FAILED", name, e.message.split("\n")[0]);
      await p.screenshot({ path: `${__dirname}/err-${name}.png`, fullPage: true });
      if (await d().count()) await d().getByRole("button", { name: /Close|Cancel/ }).first().click().catch(() => {});
    }
  };
  const go = async () => {
    await p.goto(BASE + "/portal/content", { waitUntil: "networkidle" });
    await p.waitForTimeout(1200);
  };
  const draft = async (kind, title, body) => {
    await p.getByRole("button", { name: "New content" }).click();
    await d().locator("label").filter({ hasText: new RegExp(`^\\s*${kind}\\s*$`) }).first().click();
    await d().getByLabel(/^Title/).fill(title);
    await d().getByRole("textbox", { name: /Content/ }).fill(body);
  };
  const rowActions = async (title) => {
    await p.getByRole("button", { name: `More actions for ${title}` }).click();
    await p.waitForTimeout(500);
    return (await p.getByRole("menuitem").allInnerTexts()).join(" | ");
  };

  if (part === "1") {
    await step("page", async () => {
      await go();
      await shot(p, "14-01-website-coordinator", "Website Content as the Co-ordinator: the same list, plus Your requests; publishing is the Principal's");
    });
    await step("publish-tried", async () => {
      await draft("Notice", "Parents' meeting for Grade 11", "All Grade 11 guardians are invited to meet the class teachers on Sunday at 10:00 in the main hall.");
      await shot(p, "14-02-new-notice", "A new notice drafted by the Co-ordinator: Save draft, or Send for approval in one step; there is no Publish for her (F-08 fixed)", { el: "dialog[open]" });
      await d().getByRole("button", { name: "Save draft" }).click();
      await p.waitForTimeout(1800);
      await shot(p, "14-03-publish-tried", "Saved as a draft: in the list, not yet sent to the Principal");
    });
    await step("send", async () => {
      await go();
      await shot(p, "14-04-draft-row", "The draft in the list, with Edit and Send for approval inside the table (F-09 fixed)", { full: false });
      await p.getByRole("row", { name: /Parents' meeting/ }).getByRole("button", { name: /Send for approval/ }).or(p.getByRole("button", { name: /Send for approval/ }).first()).first().click();
      await p.waitForTimeout(1500);
      await shot(p, "14-05-sent-for-approval", "Sent: the notice waits for the Principal and is listed under Your requests");
    });
    await step("more", async () => {
      await go();
      for (const [kind, title, body] of [
        ["Event", "Science exhibition", "Grade 11 and 12 science projects on show in the main hall."],
        ["Information", "Library hours during exams", "The library opens at 7:00 and closes at 19:00 during the terminal examinations."],
      ]) {
        // Straight from the form: saved and sent in one step (F-08 fixed).
        await draft(kind, title, body);
        await d().getByRole("button", { name: "Send for approval" }).click();
        await p.waitForTimeout(2000);
      }
      await shot(p, "14-06-three-requests", "Three requests waiting for the Principal");
    });
    await step("withdraw", async () => {
      await go();
      const all = p.getByRole("button", { name: /Withdraw/ });
      let w = null;
      for (let i = 0; i < (await all.count()); i++) {
        const text = await all.nth(i).evaluate((btn) => {
          let e = btn;
          while (e && !e.querySelector("h2, h3")) e = e.parentElement;
          return e?.querySelector("h2, h3")?.innerText ?? "";
        });
        if (text.includes("Library hours")) w = all.nth(i);
      }
      console.log("withdraw buttons:", await p.getByRole("button", { name: /Withdraw/ }).count());
      await w.click();
      await p.waitForTimeout(1500);
      await shot(p, "14-07-withdrawn", "The Library hours request withdrawn by the Co-ordinator: back to a draft she can still edit");
    });
  } else {
    await step("outcomes", async () => {
      await go();
      await shot(p, "14-08-outcomes", "After the Principal decided: the notice is approved and on the website, the Science exhibition declined with a reason the Co-ordinator can read");
    });
  }
  await finish(s);
})();
