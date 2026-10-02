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
  const card = (name) => p.locator("h2", { hasText: name }).locator("xpath=ancestor::*[.//button][1]");
  const controls = async (c) => console.log((await c.evaluate((e) => [...e.querySelectorAll("button, select, input, textarea, label")].filter((x) => x.offsetParent).map((x) => `${x.tagName}:${(x.getAttribute("aria-label") || (x.labels && x.labels[0] && x.labels[0].innerText) || x.innerText || "").replace(/\s+/g, " ").trim().slice(0, 50)}`))).join(" | "));
  const go = async () => {
    await p.goto(BASE + "/portal/admissions", { waitUntil: "networkidle" });
    await p.waitForTimeout(900);
  };

  await step("queue", async () => {
    await go();
    await shot(p, "08-01-queue", "The admissions queue: three public applications confirmed by email, one flagged as a possible duplicate, and one registered by the Accountant");
    await card("Pooja Sharma").getByRole("button", { name: "Review" }).click();
    await p.waitForTimeout(600);
    await shot(p, "08-02-review", "Reviewing Pooja Sharma: her details, and Ask for changes, Reject or Approve", { full: false });
    await card("Pooja Sharma").getByRole("button", { name: "Approve" }).click();
    await p.waitForTimeout(700);
    await shot(p, "08-03-approve-no-class", "Approve asks for the class to place her in; Confirm approve stays disabled until one is chosen", { full: false });
    await card("Pooja Sharma").getByLabel("Class").selectOption({ label: "+2 Science · Grade 11 (B)" });
    await shot(p, "08-04-approve-class", "Approve into +2 Science Grade 11 B", { full: false });
    await card("Pooja Sharma").getByRole("button", { name: "Confirm approve" }).click();
    await p.waitForTimeout(1800);
    await shot(p, "08-05-approved", "Approved: Pooja Sharma becomes a student with the next student ID, and leaves the queue", { full: false });
  });

  await step("changes", async () => {
    await go();
    await card("Rajesh Yadav").getByRole("button", { name: "Review" }).click();
    await card("Rajesh Yadav").getByRole("button", { name: "Ask for changes" }).click();
    await p.waitForTimeout(500);
    await card("Rajesh Yadav").getByRole("button", { name: "Send" }).click();
    await p.waitForTimeout(800);
    await shot(p, "08-06-changes-no-reason", "Ask for changes with no reason: a reason is asked for", { full: false });
    await card("Rajesh Yadav").getByLabel("Reason").fill("Please upload your +2 transcript and give a guardian phone we can reach during the day.");
    await card("Rajesh Yadav").getByRole("button", { name: "Send" }).click();
    await p.waitForTimeout(1800);
    await shot(p, "08-07a-changes-form-stays", "After Send the form stays open with the old \"Give a reason.\" message, although the request went through (finding F-01)", { full: false });
    await go();
    await shot(p, "08-07-changes-sent", "Changes asked of Rajesh Yadav: the application waits for him to fix it (the fix-it path, not a rejection)", { full: false });
  });

  await step("reject", async () => {
    await go();
    await card("Sunil Thapa").getByRole("button", { name: "Review" }).click();
    await card("Sunil Thapa").getByRole("button", { name: "Reject" }).click();
    await card("Sunil Thapa").getByLabel("Reason").fill("Grade 11 Science seats are full for 2083.");
    await shot(p, "08-08-reject-reason", "Rejecting Sunil Thapa, with the reason he will be told", { full: false });
    await card("Sunil Thapa").getByRole("button", { name: "Confirm reject" }).click();
    await p.waitForTimeout(1800);
    await shot(p, "08-09-rejected", "Rejected: final, the application leaves the queue for good", { full: false });
  });

  await step("duplicate", async () => {
    await go();
    await card("Sita Choudhary").getByRole("button", { name: "Review" }).click();
    await p.waitForTimeout(600);
    await shot(p, "08-10-duplicate-review", "Sita Choudhary, flagged as a possible duplicate: the same phone and date of birth as Sita Chaudhary (2083-00004), already a student", { full: false });
    await card("Sita Choudhary").getByRole("button", { name: "Reject" }).click();
    await card("Sita Choudhary").getByLabel("Reason").fill("Already admitted as Sita Chaudhary, 2083-00004.");
    await card("Sita Choudhary").getByRole("button", { name: "Confirm reject" }).click();
    await p.waitForTimeout(1800);
  });

  await step("accountant", async () => {
    await go();
    await card("Ritu Gupta").getByRole("button", { name: "Review" }).click();
    await card("Ritu Gupta").getByRole("button", { name: "Approve" }).click();
    await card("Ritu Gupta").getByLabel("Class").selectOption({ label: "+2 Science · Grade 12 (A)" });
    await card("Ritu Gupta").getByRole("button", { name: "Confirm approve" }).click();
    await p.waitForTimeout(1800);
    await shot(p, "08-11-queue-after", "The Accountant's registration (Ritu Gupta) approved into Grade 12 A; the queue is down to what is still waiting");
  });

  await finish(s);
})();
