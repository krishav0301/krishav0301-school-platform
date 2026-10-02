// Precondition P4: two students ask for a recheck of a published first-terminal subject, signed in as themselves.
const { secrets } = require("./lib.cjs");
const { person } = require("./people-api.cjs");

(async () => {
  const st = secrets().students;
  const ask = async (name, subject, reason) => {
    const me = await person(st[name].email ?? `${name.toLowerCase().replace(" ", ".")}@student.example`, st[name].temporaryPassword);
    const own = await me("GET", "/api/results/me");
    const result = own.results.find((r) => r.terminalName === "First terminal");
    const sub = result.card.body.subjects.find((x) => (x.name ?? x.subjectName ?? "").startsWith(subject));
    await me("POST", `/api/results/publications/${result.publicationId}/rechecks`, { offeringId: sub.offeringId, reason });
    console.log(name, "asked for a recheck of", subject);
  };
  await ask("Kritika Jha", "Chemistry", "I answered question 4 on the back page; I think it was not marked.");
  await ask("Rohan Sah", "Physics", "Please check the total of my practical marks.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
