// Precondition P1: applications that reach the Co-ordinator's queue from outside. Three public applications (one with
// the same phone and date of birth as an admitted student, to show the duplicate flag), each confirmed through the
// emailed link as an applicant would, and one student registered by the Accountant.
const crypto = require("crypto");
const { BASE, secrets, saveSecrets } = require("./lib.cjs");
const { admin, person } = require("./people-api.cjs");

(async () => {
  const principal = admin();
  const levels = (await principal("GET", "/api/academics/programmes")).programmes.flatMap((p) => p.levels.map((l) => ({ id: l.id, name: `${p.name} · ${l.name}` })));
  const level = (n) => levels.find((l) => l.name === n).id;
  const apply = async (i, body) => {
    const r = await fetch(BASE + "/api/admissions/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: BASE, "Sec-Fetch-Site": "same-origin", "CF-Connecting-IP": `203.0.113.${10 + i}` },
      body: JSON.stringify({ ...body, submissionToken: `fut-${crypto.randomUUID()}`, website: "" }),
    });
    if (r.status !== 201) throw new Error(`apply ${body.firstName}: ${r.status} ${await r.text()}`);
    const mail = await principal("GET", "/api/dev/mailbox");
    const list = mail.messages ?? mail.emails ?? mail.items ?? [];
    const msg = list.find((m) => JSON.stringify(m).includes(body.email));
    const token = /#token=([A-Za-z0-9_-]+)/.exec(JSON.stringify(msg))[1];
    const v = await fetch(BASE + "/api/admissions/verify", { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE, "Sec-Fetch-Site": "same-origin" }, body: JSON.stringify({ token }) });
    if (v.status !== 200) throw new Error(`verify ${body.firstName}: ${v.status} ${await v.text()}`);
  };
  await apply(0, { firstName: "Pooja", lastName: "Sharma", dob: "2009-09-09", phone: "9813200001", email: "pooja.sharma@applicant.example", guardianName: "Krishna Sharma", guardianPhone: "9713200001", levelId: level("+2 Science · Grade 11"), previousSchool: "Siraha Model School" });
  await apply(1, { firstName: "Rajesh", lastName: "Yadav", dob: "2006-02-14", phone: "9813200002", email: "rajesh.yadav@applicant.example", guardianName: "Mohan Yadav", guardianPhone: "9713200002", levelId: level("BBS · Year 1") });
  await apply(2, { firstName: "Sunil", lastName: "Thapa", dob: "2009-12-01", phone: "9813200003", email: "sunil.thapa@applicant.example", guardianName: "Gopal Thapa", guardianPhone: "9713200003", levelId: level("+2 Science · Grade 11") });
  // Same phone and date of birth as Sita Chaudhary, already admitted.
  await apply(3, { firstName: "Sita", lastName: "Choudhary", dob: "2009-06-14", phone: "9812100002", email: "sita.c@applicant.example", guardianName: "Chaudhary guardian", guardianPhone: "9700100002", levelId: level("+2 Science · Grade 11") });
  console.log("public applications in the queue");

  const gita = secrets().staff.gita;
  const accountant = await person(gita.email, gita.temporaryPassword);
  await accountant("POST", "/api/admissions/register", { firstName: "Ritu", lastName: "Gupta", dob: "2008-04-04", phone: "9813200004", email: "ritu.gupta@applicant.example", guardianName: "Shyam Gupta", guardianPhone: "9713200004", levelId: level("+2 Science · Grade 12") });
  console.log("Accountant's registration in the queue");
  saveSecrets({ queueReady: true });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
