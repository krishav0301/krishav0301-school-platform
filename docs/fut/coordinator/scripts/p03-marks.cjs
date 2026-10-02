// Precondition P3: the subject teachers enter first-terminal marks, through the API their marks grid uses.
// Grade 11 A: every subject entered and sent for review, except Nepali, which Kamala Rai saves as a draft only (so
// the Co-ordinator first sees Publish refused). BBS Year 1: every subject sent. FINISH=1 sends the Nepali draft too.
const { secrets, saveSecrets } = require("./lib.cjs");
const { person, admin } = require("./people-api.cjs");

const PCT = { Aarav: 92, Sita: 88, Rohan: 41, Puja: 76, Nabin: 67, Kritika: 34, Suman: 81, Anita: 59, Pooja: 72, Bibek: 78, Manisha: 64, Kiran: 52, Ritu: 70 };

(async () => {
  const ids = secrets().classIds;
  const terminals = (await admin()("GET", "/api/academics/terminals")).terminals;
  const first = terminals.find((t) => t.name === "First terminal").id;
  const teachers = Object.keys(secrets().teacherPasswords);
  const finishOnly = !!process.env.FINISH;
  for (const name of teachers) {
    const t = await person(`${name.toLowerCase().replace(" ", ".")}@school.example`);
    const mine = (await t("GET", "/api/activity/mine")).subjects.filter((x) => [ids.g11a, ids.bbs1].includes(x.classId));
    for (const subj of mine) {
      const isDraft = subj.classId === ids.g11a && subj.subjectName === "Nepali";
      if (finishOnly && !isDraft) continue;
      if (process.env.DRAFT_ONLY && !isDraft) continue;
      const path = `/api/results/classes/${subj.classId}/subjects/${subj.offeringId}/terminals/${first}`;
      const grid = await t("GET", path);
      if (!finishOnly) {
        const marks = grid.students.flatMap((st) =>
          grid.components.map((c) => {
            const base = PCT[st.name.split(" ")[0]] ?? 70;
            const pct = Math.max(0, Math.min(100, base + ((subj.subjectName.length * 7 + c.maxHundredths) % 9) - 4));
            return { enrollmentId: st.enrollmentId, componentId: c.id, valueHundredths: Math.round((c.maxHundredths * pct) / 100), absent: false };
          }),
        );
        await t("PUT", path, { marks });
      }
      if (!isDraft || finishOnly) await t("POST", `${path}/submit`);
      console.log(name, subj.subjectName, isDraft && !finishOnly ? "draft" : "sent");
    }
  }
  saveSecrets({ terminals: Object.fromEntries(terminals.map((x) => [x.name, x.id])) });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
