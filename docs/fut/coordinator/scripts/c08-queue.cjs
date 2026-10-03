const { open, shot, finish, BASE } = require("./lib.cjs");

(async () => {
  const s = await open();
  const p = s.page;
  const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
  const step = async (name, fn) => {
    if (only && !only.includes(name)) return;
    try {
      await fn();
    } catch (e) {
      console.error("FAILED", name, e.message.split("\n")[0]);
      await p.screenshot({ path: `${__dirname}/err-${name}.png`, fullPage: true });
    }
  };
  // Each application is a card; Review opens it in a side panel, where the decision is made (D-106).
  const panel = () => p.locator("dialog[open]");
  const review = async (name) => {
    await p.getByRole("button", { name: `Review the application of ${name}` }).click();
    await panel().getByRole("heading", { name }).waitFor();
    await p.waitForTimeout(500);
  };
  const go = async () => {
    await p.goto(BASE + "/portal/admissions", { waitUntil: "networkidle" });
    await p.waitForTimeout(900);
  };

  await step("queue", async () => {
    await go();
    await shot(p, "08-01-queue", "The admissions queue: what is waiting, asked for changes and possibly a duplicate, then one card per application with the section's name (F-05 fixed)");
    await review("Pooja Sharma");
    await shot(p, "08-02-review", "Reviewing Pooja Sharma in a side panel: her details, then Approve, Ask for changes or Reject", { full: false });
    await panel().getByRole("button", { name: "Approve", exact: true }).click();
    await panel().getByRole("button", { name: "Approve and admit" }).click();
    await p.waitForTimeout(700);
    await shot(p, "08-03-approve-no-class", "Approve and admit with no class chosen: the class is asked for", { full: false });
    await panel().getByLabel("Class", { exact: true }).selectOption({ label: "+2 Science · Grade 11 (B)" });
    await shot(p, "08-04-approve-class", "Approve into +2 Science Grade 11 B: the message goes as soon as a class is chosen", { full: false });
    await panel().getByRole("button", { name: "Approve and admit" }).click();
    await p.waitForTimeout(1800);
    await shot(p, "08-05-approved", "Approved: Pooja Sharma is a student, with her student ID and a temporary password shown once", { full: false });
    await panel().getByRole("button", { name: "I have noted it" }).click();
    await p.waitForTimeout(900);
  });

  await step("changes", async () => {
    await go();
    await review("Rajesh Yadav");
    await panel().getByRole("button", { name: "Ask for changes" }).click();
    await panel().getByRole("button", { name: "Send back to change" }).click();
    await p.waitForTimeout(800);
    await shot(p, "08-06-changes-no-reason", "Ask for changes with no reason: a reason is asked for", { full: false });
    await panel().getByLabel("What should they change?").fill("Please upload your +2 transcript and give a guardian phone we can reach during the day.");
    await panel().getByRole("button", { name: "Send back to change" }).click();
    await p.waitForTimeout(1800);
    await shot(p, "08-07a-changes-sent-panel", "Sent: the panel closes into what happened, with no old message left behind (F-01 fixed)", { full: false });
    await panel().getByRole("button", { name: "Done" }).click();
    await p.waitForTimeout(900);
    await shot(p, "08-07-changes-sent", "Changes asked of Rajesh Yadav: the application waits for him to fix it (the fix-it path, not a rejection)", { full: false });
  });

  await step("reject", async () => {
    await go();
    await review("Sunil Thapa");
    await panel().getByRole("button", { name: "Reject", exact: true }).click();
    await panel().getByLabel("Why is it rejected? Rejection is final.").fill("Grade 11 Science seats are full for 2083.");
    await shot(p, "08-08-reject-reason", "Rejecting Sunil Thapa, with the reason he will be told", { full: false });
    await panel().getByRole("button", { name: "Reject application" }).click();
    await p.waitForTimeout(1800);
    await shot(p, "08-09-rejected", "Rejected: final, the application leaves the queue for good", { full: false });
    await panel().getByRole("button", { name: "Done" }).click();
  });

  await step("duplicate", async () => {
    await go();
    await review("Sita Choudhary");
    await shot(p, "08-10-duplicate-review", "Sita Choudhary, flagged as a possible duplicate: the same phone and date of birth as Sita Chaudhary, already a student", { full: false });
    await panel().getByRole("button", { name: "Reject", exact: true }).click();
    await panel().getByLabel("Why is it rejected? Rejection is final.").fill("Already admitted as Sita Chaudhary.");
    await panel().getByRole("button", { name: "Reject application" }).click();
    await p.waitForTimeout(1800);
    await panel().getByRole("button", { name: "Done" }).click();
  });

  await step("accountant", async () => {
    await go();
    await review("Ritu Gupta");
    await panel().getByRole("button", { name: "Approve", exact: true }).click();
    await panel().getByLabel("Class", { exact: true }).selectOption({ label: "+2 Science · Grade 12 (A)" });
    await panel().getByRole("button", { name: "Approve and admit" }).click();
    await p.waitForTimeout(1800);
    await panel().getByRole("button", { name: "I have noted it" }).click();
    await p.waitForTimeout(900);
    await shot(p, "08-11-queue-after", "The Accountant's registration (Ritu Gupta) approved into Grade 12 A; the queue is down to what is still waiting");
  });

  await finish(s);
})();
