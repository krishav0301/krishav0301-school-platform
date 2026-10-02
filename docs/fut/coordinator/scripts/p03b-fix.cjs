// Precondition P3b: the teachers answer the Co-ordinator. Anita Mandal corrects Kritika Jha's English mark (sent back
// with a note) and sends the sheet again; Kamala Rai sends her Nepali draft.
const { secrets } = require("./lib.cjs");
const { person } = require("./people-api.cjs");

(async () => {
  const ids = secrets().classIds;
  const first = secrets().terminals["First terminal"];
  const sheet = async (teacher, subject) => {
    const t = await person(`${teacher.toLowerCase().replace(" ", ".")}@school.example`);
    const subj = (await t("GET", "/api/activity/mine")).subjects.find((x) => x.classId === ids.g11a && x.subjectName === subject);
    return { t, path: `/api/results/classes/${ids.g11a}/subjects/${subj.offeringId}/terminals/${first}` };
  };
  const en = await sheet("Anita Mandal", "English");
  const grid = await en.t("GET", en.path);
  const kritika = grid.students.find((s) => s.name.startsWith("Kritika")).enrollmentId;
  await en.t("PUT", en.path, { marks: [{ enrollmentId: kritika, componentId: grid.components[0].id, valueHundredths: 4100, absent: false }] });
  await en.t("POST", `${en.path}/submit`);
  const ne = await sheet("Kamala Rai", "Nepali");
  await ne.t("POST", `${ne.path}/submit`);
  console.log("English corrected and resent; Nepali sent");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
