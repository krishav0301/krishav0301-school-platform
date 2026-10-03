const { open, shot, finish, secrets, BASE } = require("./lib.cjs");
(async () => {
  const s = await open();
  const p = s.page;
  const box = () => p.getByLabel("Name, SID or phone");
  const search = async (q, id, title) => {
    await box().fill(q);
    await p.waitForTimeout(1500);
    await shot(p, id, title, { full: false });
  };
  try {
    await p.goto(BASE + "/portal/admissions/search", { waitUntil: "networkidle" });
    const pooja = secrets().students?.["Pooja Sharma"]?.sid;
    await search("Sah", "09-01-search-name", "Search by name: 'Sah' finds Rohan Sah and Manisha Sah, each with student ID and class, and each opens their record");
    await search("2083-00004", "09-02-search-sid", "Search by student ID: 2083-00004 is Sita Chaudhary");
    await search("9812100001", "09-03-search-phone", "Search by phone: one Aarav Mandal, 2083-00001 (the second walk-in was stopped as a duplicate, F-03 fixed)");
    await search("Pooja", "09-04-search-approved", "Pooja Sharma, approved from the queue, is now a student in Grade 11 B");
    await search("Sunil", "09-05-search-rejected", "Sunil Thapa was rejected, so he is not a student");
    await search("zzzz", "09-06-search-none", "A search that finds no one");

    // F-06: a record opens from search, and its personal details are corrected with a reason.
    await box().fill("Manisha");
    await p.waitForTimeout(1500);
    await p.getByRole("link", { name: "Open the record of Manisha Sah" }).click();
    await p.waitForTimeout(1500);
    await shot(p, "09-07-student-record", "Manisha Sah's record, opened from search, with Correct details (F-06 fixed)");
    await p.getByRole("button", { name: "Correct details" }).click();
    const d = p.locator("dialog[open]");
    await d.getByLabel("Guardian's name").fill("Ram Kumar Sah");
    await d.getByRole("button", { name: "Save the corrections" }).click();
    await p.waitForTimeout(800);
    await shot(p, "09-08-correct-no-reason", "A correction without a reason is refused: the reason is kept in the audit trail", { el: "dialog[open]" });
    await d.getByLabel("Why are these details being corrected?").fill("Guardian's full name as on the citizenship certificate.");
    await d.getByRole("button", { name: "Save the corrections" }).click();
    await p.waitForTimeout(1500);
    await shot(p, "09-09-corrected", "Corrected: her guardian is now Ram Kumar Sah, the student ID unchanged; the audit trail keeps what changed and why");
  } catch (e) {
    console.error(e);
  }
  await finish(s);
})();
