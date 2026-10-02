// Precondition P0: the Principal's part, through the API their screens use. Sections, programmes with levels and
// grading, and the staff: Co-ordinator Sita Sharma (whole school, the person under test), Co-ordinator Hari Prasad Yadav
// (Bachelor's only, for the section-scope checks) and Accountant Gita Thapa. Temporary passwords go to secrets.json.
const { saveSecrets } = require("./lib.cjs");
const { admin } = require("./people-api.cjs");

(async () => {
  const principal = admin();
  const section = async (name) => (await principal("POST", "/api/academics/sections", { name })).key;
  const plus2 = await section("+2 (Grade 11–12)");
  const bach = await section("Bachelor's");
  const programme = async (sectionKey, name, affiliation, levels, gradingPolicy) => {
    const { id } = await principal("POST", "/api/academics/programmes", { name, sectionKey, affiliation });
    for (const level of levels) await principal("POST", `/api/academics/programmes/${id}/levels`, { name: level });
    await principal("PATCH", `/api/academics/programmes/${id}`, { gradingPolicy });
    return id;
  };
  await programme(plus2, "+2 Science", "NEB", ["Grade 11", "Grade 12"], "neb_gpa");
  await programme(plus2, "+2 Management", "NEB", ["Grade 11", "Grade 12"], "neb_gpa");
  await programme(bach, "BBS", "Tribhuvan University (TU)", ["Year 1", "Year 2", "Year 3", "Year 4"], "percentage_division");

  const staff = {};
  for (const s of [
    { key: "sita", fullName: "Sita Sharma", email: "sita.sharma@school.example", phone: "9842000001", role: "coordinator" },
    { key: "hari", fullName: "Hari Prasad Yadav", email: "hari.yadav@school.example", phone: "9842000002", role: "coordinator", sectionKeys: [bach] },
    { key: "gita", fullName: "Gita Thapa", email: "gita.thapa@school.example", phone: "9842000003", role: "accountant" },
  ]) {
    const { key, ...body } = s;
    const made = await principal("POST", "/api/staff", body);
    staff[key] = { id: made.id, email: s.email, name: s.fullName, temporaryPassword: made.temporaryPassword };
  }
  saveSecrets({ sections: { plus2, bach }, staff });
  console.log("P0 done:", Object.values(staff).map((s) => `${s.name} ${s.temporaryPassword}`).join(", "));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
