// PART=1: the review board, Publish refused, English sent back. PART=2 (after the teachers' P3b): verify, publish,
// class sheet, Top 20.
const { open, shot, finish, BASE } = require("./lib.cjs");

(async () => {
  const s = await open();
  const p = s.page;
  const part = process.env.PART ?? "1";
  const step = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      console.error("FAILED", name, e.message.split("\n")[0]);
      await p.screenshot({ path: `${__dirname}/err-${name}.png`, fullPage: true });
    }
  };
  const board = async () => {
    await p.goto(BASE + "/portal/results", { waitUntil: "networkidle" });
    await p.waitForTimeout(900);
    await p.getByLabel("Terminal", { exact: true }).selectOption({ label: "First terminal" });
    await p.waitForTimeout(1500);
  };
  // The innermost block holding both the class's heading and a Publish button: the class's own card.
  const classCard = (name) => p.locator("main *").filter({ has: p.locator("h2", { hasText: name }) }).filter({ has: p.getByRole("button", { name: "Publish results" }) }).last();

  if (part === "1") {
    await step("board", async () => {
      await p.goto(BASE + "/portal/results", { waitUntil: "networkidle" });
      await p.waitForTimeout(900);
      await shot(p, "12-01-review-opens-on-final", "Review results opens on the terminal in progress, the first terminal, where the marks are waiting (F-07 fixed)", { full: false });
      await board();
      await shot(p, "12-02-review-first-terminal", "First terminal: Grade 11 A has six subjects under review and Nepali still a draft; BBS Year 1 is all under review; Publish waits for every subject");
      await shot(p, "12-03-publish-blocked", "Publish for Grade 11 A stays off and says what it is waiting for (Nepali is a draft, nothing is verified yet)", { el: 'xpath=//h2[contains(., "Grade 11 · A")]/ancestor::*[.//button[normalize-space()="Publish results"]][1]' });
    });
    await step("send-back", async () => {
      await board();
      await p.getByRole("link", { name: "Open English" }).first().click();
      await p.waitForTimeout(1200);
      await shot(p, "12-04-sheet-english", "Grade 11 A English, sent by Anita Mandal: every mark, ready to verify or send back");
      await p.getByRole("button", { name: "Send back" }).click();
      await p.waitForTimeout(700);
      const controls = await p.evaluate(() => [...document.querySelectorAll("main textarea, main input, main button")].filter((e) => e.offsetParent).map((e) => (e.labels && e.labels[0] && e.labels[0].innerText) || e.innerText).join(" | "));
      console.log("send back controls:", controls);
      const confirm = p.getByRole("button", { name: /Send back|Confirm/ }).last();
      await shot(p, "12-05-send-back-no-note", "Send back asks for a note for the teacher; it cannot be sent until one is written", { full: false });
      await p.getByLabel("Note for the teacher").fill("Please recheck Kritika Jha's paper: page 3 seems not to be counted.");
      await confirm.click();
      await p.waitForTimeout(1500);
      await shot(p, "12-06-sent-back", "English sent back to Anita Mandal with the note; she can change marks again", { full: false });
    });
  } else {
    await step("verify", async () => {
      await board();
      await shot(p, "12-07-review-all-sent", "Every Grade 11 A subject is now under review again, English with Kritika's mark corrected and Nepali sent");
      const boxes = p.locator("main input[type=checkbox]");
      const n = await boxes.count();
      for (let i = 0; i < n; i++) if (!(await boxes.nth(i).isChecked())) await boxes.nth(i).check();
      await shot(p, "12-08-verify-selected", `All ${n} subjects ticked: Verify selected verifies them together`, { full: false });
      await p.getByRole("button", { name: /^Verify selected/ }).click();
      await p.waitForTimeout(2000);
      await shot(p, "12-09-verified", "Every subject verified: Publish is now available for both classes");
    });
    await step("publish", async () => {
      // The Publish button inside the card whose heading names the class.
      const publish = async (cls) => {
        const buttons = p.getByRole("button", { name: "Publish results" });
        const n = await buttons.count();
        for (let i = 0; i < n; i++) {
          const heading = await buttons.nth(i).evaluate((btn) => {
            let e = btn;
            while (e && !e.querySelector("h2")) e = e.parentElement;
            return e?.querySelector("h2")?.innerText ?? "";
          });
          if (heading.includes(cls)) return buttons.nth(i).click();
        }
        throw new Error(`no Publish button for ${cls}`);
      };
      await board();
      await publish("Grade 11 · A");
      await p.waitForTimeout(2000);
      await shot(p, "12-10-published", "Grade 11 A first terminal published: a marks card is made for each student");
      await publish("BBS · Year 1");
      await p.waitForTimeout(2000);
      await shot(p, "12-10b-both-published", "BBS Year 1 published too; Grade 11 B and Grade 12 A have no marks yet", { full: false });
    });
    await step("sheet", async () => {
      await p.goto(BASE + "/portal/results/sheets", { waitUntil: "networkidle" });
      await p.waitForTimeout(800);
      await p.getByLabel("Class").selectOption({ label: "+2 Science · Grade 11 · A" });
      await p.waitForTimeout(800);
      await p.getByLabel("Terminal", { exact: true }).selectOption({ label: "First terminal" });
      await p.waitForTimeout(1800);
      await shot(p, "12-11-class-sheet", "Grade 11 A class sheet: NEB letter grades per subject, GPA, result and rank; a student who failed a subject gets NG and no rank");
      const link = p.getByRole("link", { name: "Kritika Jha" }).first();
      if (await link.count()) {
        await link.click();
        await p.waitForTimeout(1800);
        await shot(p, "12-12-marks-card", "Kritika Jha's marks card, a snapshot of the published result");
      }
    });
    await step("top20", async () => {
      await p.goto(BASE + "/portal/results/top20", { waitUntil: "networkidle" });
      await p.waitForTimeout(800);
      await p.getByLabel("Terminal", { exact: true }).selectOption({ label: "First terminal" });
      await p.waitForTimeout(1800);
      await shot(p, "12-13-top20", "Top 20 for the first terminal, ranked per section, from published results only");
    });
  }
  await finish(s);
})();
