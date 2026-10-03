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
    await search("Sah", "09-01-search-name", "Search by name: 'Sah' finds Rohan Sah and Manisha Sah, each with student ID and class; a result cannot be opened (finding F-06)");
    await search("2083-00004", "09-02-search-sid", "Search by student ID: 2083-00004 is Sita Chaudhary");
    await search("9812100001", "09-03-search-phone", "Search by phone: both Aarav Mandal records (2083-00001 and the duplicate 2083-00002, finding F-03)");
    await search("Pooja", "09-04-search-approved", "Pooja Sharma, approved from the queue, is now a student in Grade 11 B");
    await search("Sunil", "09-05-search-rejected", "Sunil Thapa was rejected, so he is not a student");
    await search("zzzz", "09-06-search-none", "A search that finds no one");
  } catch (e) {
    console.error(e);
  }
  await finish(s);
})();
