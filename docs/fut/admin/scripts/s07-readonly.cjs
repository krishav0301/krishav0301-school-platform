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
    await shot(p, "07-01-attendance-classes", "Attendance: today's register for each class; Grade 12 has not been marked yet");
    await go(`/portal/attendance/class?id=${y.g11}`, "text=Register for a day");
    await shot(p, "07-02-attendance-class", "A class's register for today (two absent) and the year so far; the Principal can look but not mark");
    await go(`/portal/attendance/class?id=${y.g12}`, "text=Register for a day");
    await shot(p, "07-03-attendance-not-marked", "Grade 12: no register marked yet today");
    await go("/portal/attendance/teachers", "text=Teacher attendance");
    await shot(p, "07-04-teacher-attendance", "Teacher attendance for today, marked by the Co-ordinator (Suresh Karki on leave); read only for the Principal");
    const day = p.getByRole("textbox", { name: "Day", exact: true });
    const month = p.getByRole("combobox", { name: "Month" });
    const year = p.getByRole("textbox", { name: "Year", exact: true });
    await day.fill("15");
    await p.getByRole("button", { name: "Show" }).click();
    await p.waitForTimeout(1200);
    await shot(p, "07-05a-incomplete-date", "A date with only the day filled in (no month or year) is refused, but the message says the day is not in the verified calendar (finding F-19)");
    await month.selectOption({ index: 6 });
    await year.fill("2083");
    await p.getByRole("button", { name: "Show" }).click();
    await p.waitForTimeout(1500);
    await shot(p, "07-05b-teacher-attendance-other-day", "Another day, 15 Ashwin 2083: nothing was marked that day", { full: false });
    await day.fill("1");
    await month.selectOption({ index: 1 });
    await year.fill("2090");
    await p.getByRole("button", { name: "Show" }).click();
    await p.waitForTimeout(1500);
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
    await shot(p, "07-31-student-search", "Find a student: 'Rai' finds Suman Rai");
    const link = p.getByRole("link", { name: /Suman Rai/ }).first();
    if (await link.count()) {
      await link.click();
      await p.waitForTimeout(1800);
      await shot(p, "07-32-student-record", "A student's record: personal details, guardians and enrollment; read only for the Principal");
    }
    await go("/portal/admissions/register");
    await p.waitForTimeout(1200);
    await shot(p, "07-33-register-tab-not-allowed", "The Register tab beside Student search, opened by the Principal");
  });

  await finish(s);
})();
