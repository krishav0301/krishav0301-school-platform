const { open, shot, finish, BASE } = require("./lib.cjs");

const MONTHS = ["Baisakh", "Jestha", "Asar", "Shrawan", "Bhadra", "Ashwin", "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra"];

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
      await p.screenshot({ path: `${__dirname}/err-${name}.png` });
      if (await d().count()) await d().getByRole("button", { name: "Close" }).first().click().catch(() => {});
    }
  };
  const group = (name) => d().getByRole("group", { name });
  const setDate = async (groupName, day, month, year = "2083") => {
    const g = group(groupName);
    await g.getByLabel("Day").fill(String(day));
    await g.getByLabel("Month").selectOption({ index: month });
    await g.getByLabel("Year").fill(year);
  };
  const newItem = async (kind) => {
    await p.getByRole("button", { name: "New content" }).click();
    await d().locator("label").filter({ hasText: new RegExp(`^\\s*${kind}\\s*$`) }).first().click();
  };
  const fill = async (title, body) => {
    await d().getByLabel(/^Title/).fill(title);
    await d().getByRole("textbox", { name: /Content/ }).fill(body);
  };

  await p.goto(BASE + "/portal/content", { waitUntil: "networkidle" });
  await p.waitForTimeout(1200);

  await step("list", async () => {
    await shot(p, "08-01-website-content", "Website Content: the published notice (approved earlier) and the declined event, back as a draft");
  });

  await step("new", async () => {
    await p.getByRole("button", { name: "New content" }).click();
    await p.waitForTimeout(500);
    await shot(p, "08-02-new-content-types", "New content: seven types, each with its own icon", { el: "dialog[open]" });
    await d().getByRole("button", { name: "Publish" }).click();
    await p.waitForTimeout(700);
    await shot(p, "08-03-new-content-empty", "Publish with nothing filled in: the type, title and content are asked for", { el: "dialog[open]" });
    await d().getByRole("button", { name: "Cancel" }).click();
  });

  await step("news", async () => {
    await newItem("News");
    await d().getByLabel(/^Title/).fill("Royal Softech wins the district science fair");
    const body = d().getByRole("textbox", { name: /Content/ });
    const intro = "Our Grade 11 team won first place at the Siraha district science fair.";
    await body.fill(`${intro}\n\nThe winning projects:\nSolar water purifier\nLow-cost soil tester`);
    await body.evaluate((e, n) => e.setSelectionRange(0, n), intro.length);
    await d().getByRole("button", { name: "Bold" }).click();
    const text = await body.inputValue();
    await body.evaluate((e, from) => e.setSelectionRange(from, e.value.length), text.indexOf("Solar"));
    await d().getByRole("button", { name: "Bulleted list" }).click();
    await d().getByLabel("Mark as urgent").check();
    await shot(p, "08-04-news-form", "A News item: bold text and a bulleted list from the toolbar, marked urgent, with the live preview", { el: "dialog[open]" });
    await d().getByRole("button", { name: "Publish" }).click();
    await p.waitForTimeout(1800);
    await shot(p, "08-05-news-published", "Published at once: it is on the website now");
  });

  await step("holiday", async () => {
    await newItem("Holiday");
    await fill("Dashain and Tihar holidays", "The college is closed for Dashain and Tihar. Classes resume on Sunday.");
    await setDate("Holiday date", 24, 6);
    await setDate("Last day of the holiday (optional)", 2, 5);
    await d().getByRole("button", { name: "Publish" }).click();
    await p.waitForTimeout(900);
    await shot(p, "08-06-holiday-end-before-start", "A holiday that ends (2 Bhadra) before it starts (24 Ashwin) is refused", { el: "dialog[open]" });
    await setDate("Last day of the holiday (optional)", 2, 7);
    await shot(p, "08-07-holiday-form", "Holiday from 24 Ashwin to 2 Kartik 2083; it hides itself after the last day", { el: "dialog[open]" });
    await d().getByRole("button", { name: "Publish" }).click();
    await p.waitForTimeout(1800);
  });

  await step("vacancy", async () => {
    await newItem("Vacancy");
    await fill("Mathematics teacher (+2)", "We are hiring a full-time Mathematics teacher for Grade 11 and 12.\n\nA master's degree in Mathematics and two years of teaching are required.");
    await d().getByLabel("Email or phone to contact").fill("jobs@royalsoftech.example");
    await setDate("Hide after (optional)", 10, 6);
    await d().getByRole("button", { name: "Publish" }).click();
    await p.waitForTimeout(900);
    await shot(p, "08-08-hide-after-before-publish", "Hide after 10 Ashwin, before today's publish date, is refused", { el: "dialog[open]" });
    await setDate("Hide after (optional)", 30, 7);
    await shot(p, "08-09-vacancy-form", "A vacancy with a contact, shown until 30 Kartik", { el: "dialog[open]" });
    await d().getByRole("button", { name: "Publish" }).click();
    await p.waitForTimeout(1800);
  });

  await step("event", async () => {
    await newItem("Event");
    await fill("Parents' meeting for Grade 12", "All Grade 12 guardians are invited to meet the class teacher in the main hall.");
    await setDate("Publish date", 18, 6);
    await d().getByLabel("Time").fill("09:00");
    await shot(p, "08-10-event-scheduled-form", "An event set to publish on 18 Ashwin at 09:00, Nepal time", { el: "dialog[open]" });
    await d().getByRole("button", { name: "Publish" }).click();
    await p.waitForTimeout(1800);
    await shot(p, "08-11-event-scheduled", "Scheduled: it goes on the website by itself at that date and time");
  });

  await step("info-routine", async () => {
    await newItem("Information");
    await fill("Library hours during exams", "The library opens at 7:00 and closes at 19:00 during the terminal examinations.");
    await d().getByRole("button", { name: "Save draft" }).click();
    await p.waitForTimeout(1800);
    await shot(p, "08-12-information-draft", "Information saved as a draft: kept, not on the website");
    await newItem("Routine");
    await fill("Grade 11 second terminal routine", "Sunday: English\nMonday: Nepali\nTuesday: Physics\nWednesday: Chemistry\nThursday: Mathematics");
    await d().getByRole("button", { name: "Publish" }).click();
    await p.waitForTimeout(1800);
  });

  await step("year-unverified", async () => {
    await newItem("Notice");
    await fill("Far future notice", "Testing the calendar range.");
    await setDate("Publish date", 1, 1, "2090");
    await d().getByRole("button", { name: "Save draft" }).click();
    await p.waitForTimeout(900);
    await shot(p, "08-13-unverified-year", "A publish date in BS 2090, outside the verified calendar, is refused", { el: "dialog[open]" });
    await d().getByRole("button", { name: "Cancel" }).click();
  });

  await step("filters", async () => {
    await p.goto(BASE + "/portal/content", { waitUntil: "networkidle" });
    await p.waitForTimeout(1200);
    await shot(p, "08-14-list-all", "All items: summary counts, published, scheduled and draft, urgent marked");
    await p.getByRole("button", { name: "Holiday", exact: true }).click();
    await p.waitForTimeout(1200);
    await shot(p, "08-15-filter-type", "Type filter: Holiday", { full: false });
    await p.getByRole("button", { name: "All", exact: true }).first().click();
    await p.getByRole("button", { name: "Scheduled", exact: true }).click();
    await p.waitForTimeout(1200);
    await shot(p, "08-16-filter-scheduled", "Status filter: Scheduled", { full: false });
    await p.getByRole("button", { name: "Draft", exact: true }).click();
    await p.waitForTimeout(1200);
    await shot(p, "08-17-filter-draft", "Status filter: Draft", { full: false });
    await p.getByRole("button", { name: "All", exact: true }).nth(1).click();
    await p.getByRole("searchbox", { name: "Search content" }).fill("teacher");
    await p.waitForTimeout(1500);
    await shot(p, "08-18-search", "Search 'teacher': the vacancy", { full: false });
    await p.getByRole("searchbox", { name: "Search content" }).fill("");
    await p.waitForTimeout(1200);
  });

  await step("edit-declined", async () => {
    await p.getByRole("button", { name: "Edit Inter-college quiz contest" }).click();
    await p.waitForTimeout(800);
    const body = d().getByRole("textbox", { name: /Content/ });
    await body.press("Control+End");
    await body.type("\n\nDate: 25 Ashwin 2083, 11:00, in the main hall.");
    await shot(p, "08-19-edit-declined-draft", "Editing the event the Principal declined: the date, time and venue added", { el: "dialog[open]" });
    await d().getByRole("button", { name: "Publish" }).click();
    await p.waitForTimeout(1800);
  });

  await step("row-actions", async () => {
    await p.goto(BASE + "/portal/content", { waitUntil: "networkidle" });
    await p.waitForTimeout(1200);
    await p.getByRole("button", { name: "More actions for Grade 11 first terminal results are out" }).click();
    await shot(p, "08-20-row-menu", "A published item's menu: take down or archive", { full: false });
    await p.getByRole("menuitem", { name: /Take down/ }).click();
    await p.waitForTimeout(1500);
    await shot(p, "08-21-taken-down", "Taken down: it is a draft again, with Undo", { full: false });
    await p.getByRole("button", { name: /More actions for Grade 11 second terminal routine/ }).click();
    await p.getByRole("menuitem", { name: /Archive/ }).click();
    await p.waitForTimeout(1500);
    await p.getByRole("button", { name: "Archived", exact: true }).click();
    await p.waitForTimeout(1200);
    await shot(p, "08-22-archived", "The routine archived: off the website, kept in the archive", { full: false });
    await p.getByRole("button", { name: "All", exact: true }).nth(1).click();
    await p.waitForTimeout(800);
  });

  // The public website.
  await step("public", async () => {
    await p.goto(BASE + "/", { waitUntil: "networkidle" });
    await p.waitForTimeout(800);
    await shot(p, "08-23-public-home", "The public website's home page with the latest updates");
    await p.goto(BASE + "/notices", { waitUntil: "networkidle" });
    await p.waitForTimeout(800);
    await shot(p, "08-24-public-notices", "Notices and updates on the public website: urgent news, the holiday, the vacancy and the quiz; the scheduled meeting and the draft are not shown");
  });

  await finish(s);
})();
