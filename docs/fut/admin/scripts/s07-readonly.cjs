const { open, shot, finish, secrets, BASE } = require("./lib.cjs");

(async () => {
  const s = await open();
  const p = s.page;
  const y = secrets().year;
  const go = async (url, wait) => {
    await p.goto(BASE + url, { waitUntil: "networkidle" });
    if (wait) await p.waitForSelector(wait);
    await p.waitForTimeout(700);
  };
  const step = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      console.error("FAILED", name, e.message.split("\n")[0]);
      await p.screenshot({ path: `${__dirname}/err-${name}.png` });
    }
  };

  // --- Attendance (read only for the Principal)
  await step("att", async () => {
    await go("/portal/attendance", "text=Classes");
    await shot(p, "07-01-attendance-classes", "Attendance: the day at a glance (present, absent, classes not marked, teachers on leave), then each class with its Class Teacher; Grade 12 is not marked yet, so it comes first");
    await go(`/portal/attendance/class?id=${y.g11}`, "text=Today's register");
    await shot(p, "07-02-attendance-class", "A class's register for today (two absent), in words; the Principal can look but not mark");
    await p.getByRole("button", { name: "This year so far" }).click();
    await p.waitForTimeout(500);
    await shot(p, "07-02b-attendance-year", "The same class, this year so far: days present, the percentage and who is below 75%");
    await go(`/portal/attendance/class?id=${y.g12}`, "text=Today's register");
    await shot(p, "07-03-attendance-not-marked", "Grade 12: no register marked yet today");
    await go("/portal/attendance/teachers", "text=Teacher attendance");
    await shot(p, "07-04-teacher-attendance", "Teacher attendance for today, marked by the Co-ordinator (Suresh Karki on leave); read only for the Principal");
    const pick = async (d, monthIndex, y) => {
      if (!(await p.getByRole("dialog").isVisible().catch(() => false))) await p.getByRole("button", { name: "Change date" }).click();
      const dialog = p.getByRole("dialog");
      await dialog.getByRole("textbox", { name: "Day", exact: true }).fill(d);
      if (monthIndex !== null) await dialog.getByRole("combobox", { name: "Month" }).selectOption({ index: monthIndex });
      if (y !== null) await dialog.getByRole("textbox", { name: "Year", exact: true }).fill(y);
      await dialog.getByRole("button", { name: "Show this day" }).click();
      await p.waitForTimeout(1500);
    };
    await pick("15", null, null);
    await shot(p, "07-05a-incomplete-date", "Change date with only the day filled in (no month or year) asks for the day, the month and the year (F-19 fixed)", { full: false });
    await pick("15", 6, "2083");
    await shot(p, "07-05b-teacher-attendance-other-day", "Another day, 15 Ashwin 2083: nothing was marked that day", { full: false });
    await pick("1", 1, "2090");
    await shot(p, "07-06-unverified-year", "1 Baisakh 2090, outside the verified calendar (2000 to 2083), is refused", { full: false });
  });

  // --- Classwork
  await step("cw", async () => {
    await go("/portal/classwork", "text=Classes today");
    await shot(p, "07-07-classwork", "Classwork: today's activity log for each class");
    await go(`/portal/classwork/class?id=${y.g11}`, "text=Physics");
    await shot(p, "07-08-classwork-class", "Grade 11's activity log today: what each subject teacher wrote, and the subjects with nothing yet");
  });

  // --- Fees (read only)
  await step("fees", async () => {
    await go("/portal/fees", "text=Find a student");
    await shot(p, "07-09-fees-find", "Fees: find a student's fee account by name, SID or phone");
    await p.getByLabel("Name, SID or phone").fill("Sita");
    await p.waitForTimeout(1500);
    await shot(p, "07-10-fees-search", "Searching 'Sita': the matching student");
    await p.getByRole("link", { name: /Sita Chaudhary/ }).first().click();
    await p.waitForTimeout(1800);
    await shot(p, "07-11-fee-account-discount", "Sita Chaudhary's fee account: charges, her cash payment and the approved 10% discount; the balance is worked out, never stored");
    await go("/portal/fees", "text=Find a student");
    await p.getByLabel("Name, SID or phone").fill("2083-00004");
    await p.waitForTimeout(1500);
    await p.getByRole("link", { name: /Puja Yadav/ }).first().click();
    await p.waitForTimeout(1800);
    await shot(p, "07-12-fee-account-refund", "Puja Yadav (found by SID): overpaid, with the approved refund");
    await go("/portal/fees", "text=Find a student");
    await p.getByLabel("Name, SID or phone").fill("Nabin");
    await p.waitForTimeout(1500);
    await p.getByRole("link", { name: /Nabin Thakur/ }).first().click();
    await p.waitForTimeout(1800);
    await shot(p, "07-13-fee-account-reversal", "Nabin Thakur: the wrong payment and its approved reversal, both kept in the ledger");
    await go("/portal/fees", "text=Find a student");
    await p.getByLabel("Name, SID or phone").fill("Aarav");
    await p.waitForTimeout(1500);
    await p.getByRole("link", { name: /Aarav Mandal/ }).first().click();
    await p.waitForTimeout(1800);
    await shot(p, "07-14-fee-account-receipts", "Aarav Mandal: a cash payment (sent twice, recorded once) and a verified bank voucher, each with a receipt");
    const receipt = p.getByRole("link", { name: /receipt|RCT|-0000/i }).first();
    if (await receipt.count()) {
      await receipt.click();
      await p.waitForTimeout(1800);
      await shot(p, "07-15-receipt", "A receipt, generated from the ledger, never edited");
    } else console.log("no receipt link found");
    await go("/portal/fees", "text=Find a student");
    await p.getByLabel("Name, SID or phone").fill("zzzz");
    await p.waitForTimeout(1500);
    await shot(p, "07-16-fees-search-none", "A search that finds nobody", { full: false });
  });
  await step("structures", async () => {
    await go("/portal/fees/structures", "text=Fee structures");
    await shot(p, "07-17-fee-structures", "Fee structures for the year: live (approved) ones");
    await go(`/portal/fees/structure?id=${y.structures.g11}`);
    await shot(p, "07-18-fee-structure", "The Grade 11 fee structure: monthly, yearly and one-time items; read only for the Principal");
    await go("/portal/fees/dues", "text=Dues");
    await shot(p, "07-19-dues", "Dues: what each student owes and how much is overdue, with a CSV download");
    const [download] = await Promise.all([p.waitForEvent("download", { timeout: 15000 }), p.getByRole("link", { name: "Download CSV" }).click()]);
    const file = `${__dirname}/dues.csv`;
    await download.saveAs(file);
    console.log("CSV:", require("fs").readFileSync(file, "utf8").split("\n").slice(0, 3).join(" / "));
  });

  // --- Results (read only)
  await step("results", async () => {
    await go("/portal/results", "text=Changes after publishing");
    await shot(p, "07-20-results-changes", "Results: changes after publishing (rechecks); none yet");
    await go("/portal/results/sheets", "text=Class sheets");
    await shot(p, "07-21-class-sheets", "Class sheets: choose a class and a published terminal");
    await p.getByLabel("Class").selectOption({ index: 1 });
    await p.waitForTimeout(1200);
    const t = p.getByLabel("Terminal");
    if ((await t.locator("option").count()) > 1) await t.selectOption({ index: 1 });
    await p.waitForTimeout(1800);
    await shot(p, "07-22-class-sheet", "Grade 11, first terminal: every student's NEB grades and GPA, ranked; ties share a rank");
    await go("/portal/results/top20", "text=Top 20");
    const t2 = p.getByLabel("Terminal");
    if ((await t2.locator("option").count()) > 1) await t2.selectOption({ index: 1 });
    await p.waitForTimeout(1800);
    await shot(p, "07-23-top20", "Top 20, ranked per section, only from published results");
  });

  // --- Reports and the read-only setup pages
  await step("reports", async () => {
    await go("/portal/reports", "text=Reports");
    await shot(p, "07-24-reports", "Reports: everything the Principal reads but does not change, in one place");
    for (const [i, [url, title]] of [
      ["/portal/setup", "Academic years: the current year and its dates (read only for the Principal)"],
      ["/portal/setup/classes", "Classes this year (read only)"],
      ["/portal/setup/terminals", "Terminals of the year (read only)"],
      ["/portal/setup/subjects", "The school's subjects (read only)"],
      ["/portal/setup/curriculum", "Curriculum: what each level studies, credit hours and marks (read only)"],
      ["/portal/people/teaching", "Teaching: who teaches what, and each Class Teacher"],
    ].entries()) {
      await go(url);
      await p.waitForTimeout(800);
      await shot(p, `07-${25 + i}-${url.split("/").pop()}`, title);
    }
    await go("/portal/admissions/search", "text=Student search");
    await p.getByLabel("Name, SID or phone").fill("Rai");
    await p.waitForTimeout(1500);
    await shot(p, "07-31-student-search", "Find a student: 'Rai' finds Suman Rai; the name opens the record (F-09 fixed), and there is no Register tab (F-08 fixed)");
    const link = p.getByRole("link", { name: /Suman Rai/ }).first();
    if (await link.count()) {
      await link.click();
      await p.waitForTimeout(1800);
      await shot(p, "07-32-student-record", "Suman Rai's record: student ID, class, date of birth, contacts and guardian; read only for the Principal");
    }
    await go("/portal/admissions/register");
    await p.waitForTimeout(1200);
    await shot(p, "07-33-register-tab-not-allowed", "The registration form's address, opened by the Principal: \"You do not have access to this page\" (F-08, F-14 fixed)");
  });

  await finish(s);
})();
