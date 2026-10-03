const { open, shot, finish, BASE } = require("./lib.cjs");

(async () => {
  const s = await open();
  const p = s.page;
  const card = (name) => p.locator("main *").filter({ has: p.locator("h2", { hasText: name }) }).filter({ has: p.getByLabel("Reason") }).last();
  try {
    await p.goto(BASE + "/portal/results/rechecks", { waitUntil: "networkidle" });
    await p.waitForTimeout(1000);
    await shot(p, "13-01-rechecks", "Rechecks: two students ask about a published subject; each shows the marks and asks for a reason the student will see");
    const rohan = card("Rohan Sah");
    await rohan.getByLabel("Reason").fill("Practical marks rechecked with the lab teacher: the total is correct.");
    await rohan.getByRole("button", { name: "No change" }).click();
    await p.waitForTimeout(1500);
    await shot(p, "13-02-recheck-no-change", "Rohan Sah's recheck closed with no change, and the reason", { full: false });

    const kritika = card("Kritika Jha");
    await kritika.getByLabel(/^Theory/).fill("29.75");
    await p.waitForTimeout(300);
    const buttons = await kritika.getByRole("button").allInnerTexts();
    console.log("buttons after edit:", buttons.join(" | "));
    await shot(p, "13-03-recheck-mark-changed", "Kritika Jha's Chemistry theory raised from 24.75 to 29.75: the button now saves a change, and a reason is still required", { full: false });
    await kritika.getByLabel("Reason").fill("Question 4 on the back page was not marked; 5 marks added.");
    await kritika.getByRole("button").filter({ hasNotText: "No change" }).last().click();
    await p.waitForTimeout(1800);
    await shot(p, "13-04-recheck-changed", "Changed: the published result is updated, the marks card gets a new version, and the Principal is told of the change");

    await p.goto(BASE + "/portal/results/sheets", { waitUntil: "networkidle" });
    await p.getByLabel("Class").selectOption({ label: "+2 Science · Grade 11 · A" });
    await p.waitForTimeout(800);
    await p.getByLabel("Terminal").selectOption({ label: "First terminal" });
    await p.waitForTimeout(1800);
    await shot(p, "13-05-sheet-after-recheck", "The class sheet after the recheck: Kritika Jha's Chemistry grade reflects the new mark");
  } catch (e) {
    console.error(e);
    await p.screenshot({ path: `${__dirname}/err-rechecks.png`, fullPage: true });
  }
  await finish(s);
})();
