const { open, shot, finish, BASE } = require("./lib.cjs");

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
  const add = async (level, label, keepOpen) => {
    await p.getByRole("button", { name: "Add a class" }).first().click();
    await d().getByLabel("Level").selectOption({ label: level });
    if (label) await d().getByLabel("Label (optional)").fill(label);
    await d().getByRole("button", { name: "Add a class" }).click();
    await p.waitForTimeout(1100);
    if (!keepOpen && (await d().count())) await d().getByRole("button", { name: "Close" }).click();
  };

  await step("classes", async () => {
    await p.goto(BASE + "/portal/setup/classes", { waitUntil: "networkidle" });
    await p.waitForTimeout(800);
    await shot(p, "04-01-classes-empty", "Classes of 2083: none yet");
    await p.getByRole("button", { name: "Add a class" }).first().click();
    await d().getByRole("button", { name: "Add a class" }).click();
    await p.waitForTimeout(700);
    await shot(p, "04-02-class-no-level", "Add a class without a level: refused", { el: "dialog[open]" });
    await d().getByRole("button", { name: "Close" }).click();
    await p.getByRole("button", { name: "Add a class" }).first().click();
    await d().getByLabel("Level").selectOption({ label: "+2 Science · Grade 11" });
    await d().getByLabel("Label (optional)").fill("A");
    await shot(p, "04-03-class-form", "Grade 11 of +2 Science, label A (a label like Morning or A is optional)", { el: "dialog[open]" });
    await d().getByRole("button", { name: "Add a class" }).click();
    await p.waitForTimeout(1100);
    if (await d().count()) await d().getByRole("button", { name: "Close" }).click();
    await add("+2 Science · Grade 11", "B");
    await add("+2 Science · Grade 12", "A");
    await add("BBS · Year 1", "");
    await add("+2 Management · Grade 11", "Morning");
    await shot(p, "04-04-classes", "Five classes for 2083");
    await add("+2 Science · Grade 11", "A", true);
    await shot(p, "04-05-class-duplicate", "Grade 11 A a second time is refused", { full: false });
    if (await d().count()) await d().getByRole("button", { name: "Close" }).click();
  });

  await step("class-actions", async () => {
    await p.goto(BASE + "/portal/setup/classes", { waitUntil: "networkidle" });
    await p.waitForTimeout(800);
    const mg = "+2 Management · Grade 11 (Morning)";
    await p.getByRole("button", { name: `Switch off ${mg}` }).click();
    await p.waitForTimeout(1200);
    await shot(p, "04-06-class-switched-off", "The Management class switched off: kept, marked Switched off, not offered for new students", { full: false });
    await p.getByRole("button", { name: `Switch on ${mg}` }).click();
    await p.waitForTimeout(1200);
    await p.getByRole("button", { name: `Delete ${mg}` }).click();
    await p.waitForTimeout(600);
    await shot(p, "04-07-class-delete-confirm", "Delete asks once more, because it cannot be undone (offered only while nothing is attached)", { full: false });
    await p.getByRole("button", { name: /^Yes, delete/ }).first().click();
    await p.waitForTimeout(1200);
    await shot(p, "04-08-class-deleted", "The empty Management class is deleted; four classes remain");
  });

  await finish(s);
})();
