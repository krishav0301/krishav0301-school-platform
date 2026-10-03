const { open, shot, finish, BASE } = require("./lib.cjs");

(async () => {
  const s = await open();
  const p = s.page;
  // Each open recheck is decided in a side panel, opened with Decide (D-106).
  const panel = () => p.locator("dialog[open]");
  const decide = async (name) => {
    await p.getByRole("button", { name: new RegExp(`^Decide the recheck of ${name}`) }).click();
    await panel().getByRole("heading", { name: new RegExp(name) }).waitFor();
  };
  try {
    await p.goto(BASE + "/portal/results/rechecks", { waitUntil: "networkidle" });
    await p.waitForTimeout(1000);
    await shot(p, "13-01-rechecks", "Rechecks: two students ask about a published subject; the figures say two are waiting, and each has Decide");
    await decide("Rohan Sah");
    await shot(p, "13-01b-recheck-panel", "Rohan Sah's recheck in a side panel: why he asked, the marks now, the marks to correct and a reason; No change stays off until a reason is written", { full: false });
    await panel().getByLabel("Reason").fill("Practical marks rechecked with the lab teacher: the total is correct.");
    await panel().getByRole("button", { name: "No change" }).click();
    await p.waitForTimeout(1500);
    await shot(p, "13-02-recheck-no-change", "Rohan Sah's recheck closed with no change, and the reason", { full: false });

    await decide("Kritika Jha");
    await panel().getByLabel(/^Theory/).fill("29.75");
    await p.waitForTimeout(300);
    await shot(p, "13-03-recheck-mark-changed", "Kritika Jha's Chemistry theory raised from 24.75 to 29.75: the button now saves a change, and a reason is still required", { full: false });
    await panel().getByLabel("Reason").fill("Question 4 on the back page was not marked; 5 marks added.");
    await panel().getByRole("button", { name: "Save the corrected marks" }).click();
    await p.waitForTimeout(1800);
    await shot(p, "13-04-recheck-changed", "Changed: the published result is updated, the marks card gets a new version, and the Principal is told of the change");

    await p.goto(BASE + "/portal/results/sheets", { waitUntil: "networkidle" });
    await p.getByLabel("Class").selectOption({ label: "+2 Science · Grade 11 · A" });
    await p.waitForTimeout(800);
    await p.getByLabel("Terminal", { exact: true }).selectOption({ label: "First terminal" });
    await p.waitForTimeout(1800);
    await shot(p, "13-05-sheet-after-recheck", "The class sheet after the recheck: Kritika Jha's Chemistry grade reflects the new mark");
  } catch (e) {
    console.error(e);
    await p.screenshot({ path: `${__dirname}/err-rechecks.png`, fullPage: true });
  }
  await finish(s);
})();
