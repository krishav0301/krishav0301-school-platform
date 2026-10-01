import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { auditActions, auditKey, call, count, db, person, seedSections, type Person, programmesAdmin } from "./academics-helpers";

let coordinator: Person, plus2Coordinator: Person, bachelorsCoordinator: Person, admin: Person, accountant: Person, teacher: Person, student: Person, superAdmin: Person;
beforeAll(async () => {
  await seedSections();
  coordinator = await person("coordinator", "institution");
  plus2Coordinator = await person("coordinator", "section", "plus2");
  bachelorsCoordinator = await person("coordinator", "section", "bachelors");
  admin = await person("admin", "institution");
  accountant = await person("accountant", "institution");
  teacher = await person("teacher", "assigned");
  student = await person("student", "own");
  superAdmin = await person("super_admin", "institution");
});

const send = (method: string, path: string, body: unknown, who: Person) => call(`/api/academics${path}`, { method, body, cookie: who.cookie });
const post = (path: string, body: unknown, who: Person) => send("POST", path, body, who);
const patch = (path: string, body: unknown, who: Person) => send("PATCH", path, body, who);
const get = (path: string, who: Person) => call(`/api/academics${path}`, { cookie: who.cookie });
const idOf = async (response: Response) => ((await response.json()) as { id: string }).id;
const noId = "0".repeat(32);
let n = 0;
const label = (prefix: string) => `${prefix} ${++n} ${crypto.randomUUID().slice(0, 6)}`;

async function makeLevel(sectionKey: "plus2" | "bachelors") {
  const programme = await post("/programmes", { name: label("Programme"), sectionKey, affiliation: "Board" }, await programmesAdmin());
  expect(programme.status).toBe(201);
  const level = await post(`/programmes/${await idOf(programme)}/levels`, { name: "Grade 11" }, await programmesAdmin());
  expect(level.status).toBe(201);
  return idOf(level);
}
const makeSubject = async (over: Record<string, unknown> = {}, who: Person = coordinator) => {
  const response = await post("/subjects", { name: label("Subject"), ...over }, who);
  expect(response.status).toBe(201);
  return idOf(response);
};

interface Curriculum {
  level: { id: string; name: string; programmeId: string; programmeName: string };
  groups: { id: string; name: string; pickCount: number; active: boolean }[];
  offerings: {
    id: string;
    subject: { id: string; name: string; code: string | null; archived: boolean };
    creditHundredths: number | null;
    group: { id: string; name: string } | null;
    active: boolean;
    components: { id: string; name: string; maxHundredths: number; ordinal: number; active: boolean }[];
  }[];
}

const reads = ["/subjects", `/curriculum?level=${noId}`];
const writes: [string, string, unknown][] = [
  ["POST", "/subjects", { name: "x" }],
  ["PATCH", `/subjects/${noId}`, { name: "x" }],
  ["POST", "/offerings", { levelId: noId, subjectId: noId }],
  ["PATCH", `/offerings/${noId}`, { active: false }],
  ["POST", `/offerings/${noId}/components`, { name: "x", maxHundredths: 100 }],
  ["PATCH", `/components/${noId}`, { name: "x" }],
  ["POST", `/levels/${noId}/groups`, { name: "x" }],
  ["PATCH", `/groups/${noId}`, { name: "x" }],
];

// ---------------------------------------------------------------------------------------------
describe("who may use the subject routes", () => {
  it("nobody who is signed out: 401 everywhere, and a garbage body is not even looked at", async () => {
    for (const path of reads) expect((await call(`/api/academics${path}`)).status, path).toBe(401);
    for (const [method, path, body] of writes) expect((await call(`/api/academics${path}`, { method, body })).status, `${method} ${path}`).toBe(401);
    expect((await call("/api/academics/offerings", { method: "POST", body: { nonsense: true } })).status).toBe(401);
  });

  it("students, teachers and accountants: 403 everywhere, and nothing is written", async () => {
    const before = await count("SELECT (SELECT COUNT(*) FROM subjects) + (SELECT COUNT(*) FROM subject_offerings) AS n");
    for (const who of [student, teacher, accountant]) {
      for (const path of reads) expect((await get(path, who)).status, path).toBe(403);
      for (const [method, path, body] of writes) expect((await send(method, path, body, who)).status, `${method} ${path}`).toBe(403);
    }
    expect(await count("SELECT (SELECT COUNT(*) FROM subjects) + (SELECT COUNT(*) FROM subject_offerings) AS n")).toBe(before);
  });

  it("the Admin may look (200; an unknown level is 404) but not change anything", async () => {
    expect((await get("/subjects", admin)).status).toBe(200);
    expect((await get(`/curriculum?level=${noId}`, admin)).status).toBe(404);
    for (const [method, path, body] of writes) expect((await send(method, path, body, admin)).status, `${method} ${path}`).toBe(403);
  });

  it("answers are never cached", async () => {
    expect((await get("/subjects", coordinator)).headers.get("Cache-Control")).toBe("no-store");
    const level = await makeLevel("bachelors");
    expect((await get(`/curriculum?level=${level}`, coordinator)).headers.get("Cache-Control")).toBe("no-store");
  });

  it("a switched-off Co-ordinator with a valid sign-in is refused (403), not served from the token", async () => {
    const off = await person("coordinator", "institution");
    await db.prepare("UPDATE users SET is_active = 0 WHERE public_id = ?1").bind(off.publicId).run();
    const before = await count("SELECT COUNT(*) AS n FROM subjects");
    expect((await post("/subjects", { name: label("Subject") }, off)).status).toBe(403);
    expect(await count("SELECT COUNT(*) AS n FROM subjects")).toBe(before);
  });
});

// ---------------------------------------------------------------------------------------------
describe("keeping a level's subjects, end to end", () => {
  it("subject, group, offering with group and credit, components: created, read together, changed and audited", async () => {
    const levelId = await makeLevel("plus2");
    const biology = await makeSubject({ name: label("Biology"), code: label("BIO").slice(0, 12) });
    const maths = await makeSubject({ name: label("Mathematics") });

    const groupResponse = await post(`/levels/${levelId}/groups`, { name: "Science option", pickCount: 1 }, coordinator);
    expect(groupResponse.status).toBe(201);
    const groupId = await idOf(groupResponse);

    const bio = await post("/offerings", { levelId, subjectId: biology, creditHundredths: 375, groupId }, coordinator);
    expect(bio.status).toBe(201);
    const bioId = await idOf(bio);
    const plain = await post("/offerings", { levelId, subjectId: maths }, coordinator);
    expect(plain.status).toBe(201);
    const mathsOffering = await idOf(plain);

    const theory = await post(`/offerings/${bioId}/components`, { name: "Theory", maxHundredths: 7500 }, coordinator);
    expect(theory.status).toBe(201);
    const practical = await post(`/offerings/${bioId}/components`, { name: "Practical", maxHundredths: 2500 }, coordinator);
    expect(practical.status).toBe(201);

    const response = await get(`/curriculum?level=${levelId}`, coordinator);
    expect(response.status).toBe(200);
    const curriculum = (await response.json()) as Curriculum;
    expect(curriculum.level).toMatchObject({ id: levelId, name: "Grade 11" });
    expect(curriculum.groups).toEqual([{ id: groupId, name: "Science option", pickCount: 1, active: true }]);
    expect(curriculum.offerings).toHaveLength(2);
    const bioRow = curriculum.offerings.find((o) => o.id === bioId)!;
    expect(bioRow).toMatchObject({ creditHundredths: 375, group: { id: groupId, name: "Science option" }, active: true });
    expect(bioRow.subject.id).toBe(biology);
    expect(bioRow.components.map((c) => [c.name, c.maxHundredths, c.ordinal])).toEqual([["Theory", 7500, 1], ["Practical", 2500, 2]]);
    expect(curriculum.offerings.find((o) => o.id === mathsOffering)).toMatchObject({ creditHundredths: null, group: null, components: [] });

    const subjects = (await (await get("/subjects", coordinator)).json()) as { subjects: { id: string; name: string; code: string | null; archived: boolean }[] };
    expect(subjects.subjects.find((s) => s.id === biology)).toMatchObject({ archived: false });

    expect((await patch(`/offerings/${bioId}`, { creditHundredths: 400, groupId: null }, coordinator)).status).toBe(200);
    expect((await patch(`/groups/${groupId}`, { pickCount: 2, active: false }, coordinator)).status).toBe(200);
    expect((await patch(`/components/${await idOf(practical)}`, { maxHundredths: 3000, active: false }, coordinator)).status).toBe(200);
    expect((await patch(`/subjects/${biology}`, { archived: true }, coordinator)).status).toBe(200);

    const after = (await (await get(`/curriculum?level=${levelId}`, coordinator)).json()) as Curriculum;
    const bioAfter = after.offerings.find((o) => o.id === bioId)!;
    expect(bioAfter).toMatchObject({ creditHundredths: 400, group: null });
    expect(bioAfter.subject.archived).toBe(true);
    expect(after.groups[0]).toMatchObject({ pickCount: 2, active: false });
    expect(bioAfter.components[1]).toMatchObject({ maxHundredths: 3000, active: false });

    expect(await auditActions(bioId)).toEqual(["academics.offering.created", "academics.offering.updated"]);
    const actor = await db.prepare("SELECT u.public_id AS actor FROM audit_events a JOIN users u ON u.id = a.actor_user_id WHERE a.entity_public_id = ?1 LIMIT 1").bind(bioId).first<{ actor: string }>();
    expect(actor!.actor).toBe(coordinator.publicId);
  });

  it("status codes for the failure cases: 400 for a bad shape, 422 for a broken rule, 404, and 409", async () => {
    const levelId = await makeLevel("bachelors");
    const subjectId = await makeSubject();
    expect((await post("/subjects", { code: "x" }, coordinator)).status).toBe(400);
    expect((await post("/offerings", { levelId, subjectId, creditHundredths: 3.75 }, coordinator)).status).toBe(400);
    expect((await post(`/levels/${levelId}/groups`, { name: "x", stray: 1 }, coordinator)).status).toBe(400);

    const offering = await post("/offerings", { levelId, subjectId }, coordinator);
    expect(offering.status).toBe(201);
    const repeat = await post("/offerings", { levelId, subjectId }, coordinator);
    expect(repeat.status).toBe(409);
    expect(await repeat.json()).toEqual({ error: "conflict" });

    await patch(`/subjects/${subjectId}`, { archived: true }, coordinator);
    const other = await makeLevel("bachelors");
    const archived = await post("/offerings", { levelId: other, subjectId }, coordinator);
    expect(archived.status).toBe(422);
    expect(await archived.json()).toMatchObject({ error: "invalid" });

    expect((await post("/offerings", { levelId: noId, subjectId: await makeSubject() }, coordinator)).status).toBe(404);
    expect((await patch(`/groups/${noId}`, { name: "x" }, coordinator)).status).toBe(404);
    expect((await get(`/curriculum?level=${noId}`, coordinator)).status).toBe(404);
    expect((await post("/subjects", { name: (await (await get("/subjects", coordinator)).json() as { subjects: { name: string }[] }).subjects[0]!.name.toUpperCase() }, coordinator)).status).toBe(409);
  });
});

// ---------------------------------------------------------------------------------------------
describe("a section-scoped Co-ordinator gets nothing from the other section (data-level)", () => {
  it("cannot read a Bachelor's level's curriculum (404), even with the right id, but reads their own", async () => {
    const plus2 = await makeLevel("plus2");
    const bachelors = await makeLevel("bachelors");
    expect((await get(`/curriculum?level=${bachelors}`, plus2Coordinator)).status).toBe(404);
    expect((await get(`/curriculum?level=${plus2}`, plus2Coordinator)).status).toBe(200);
    expect((await get(`/curriculum?level=${plus2}`, bachelorsCoordinator)).status).toBe(404);
    expect((await get(`/curriculum?level=${bachelors}`, coordinator)).status).toBe(200);
    expect((await get(`/curriculum?level=${bachelors}`, admin)).status).toBe(200);
  });

  it("cannot change the other section's groups, offerings or components, even with the right ids", async () => {
    const bachelors = await makeLevel("bachelors");
    const subjectId = await makeSubject();
    const groupId = await idOf(await post(`/levels/${bachelors}/groups`, { name: "Option" }, coordinator));
    const offeringId = await idOf(await post("/offerings", { levelId: bachelors, subjectId }, coordinator));
    const componentId = await idOf(await post(`/offerings/${offeringId}/components`, { name: "Theory", maxHundredths: 7500 }, coordinator));

    expect((await post(`/levels/${bachelors}/groups`, { name: "Sneaky" }, plus2Coordinator)).status).toBe(403);
    expect((await patch(`/groups/${groupId}`, { name: "Hijacked" }, plus2Coordinator)).status).toBe(403);
    expect((await post("/offerings", { levelId: bachelors, subjectId: await makeSubject() }, plus2Coordinator)).status).toBe(403);
    expect((await patch(`/offerings/${offeringId}`, { active: false }, plus2Coordinator)).status).toBe(403);
    expect((await post(`/offerings/${offeringId}/components`, { name: "Sneaky", maxHundredths: 100 }, plus2Coordinator)).status).toBe(403);
    expect((await patch(`/components/${componentId}`, { name: "Hijacked" }, plus2Coordinator)).status).toBe(403);

    expect(await db.prepare("SELECT name FROM elective_groups WHERE public_id = ?1").bind(groupId).first()).toEqual({ name: "Option" });
    expect(await db.prepare("SELECT is_active FROM subject_offerings WHERE public_id = ?1").bind(offeringId).first()).toEqual({ is_active: 1 });
    expect(await db.prepare("SELECT name FROM mark_components WHERE public_id = ?1").bind(componentId).first()).toEqual({ name: "Theory" });
  });

  it("may add a name to the catalogue (201) but not rename it (403); a whole-school Co-ordinator and the Super Admin may", async () => {
    const id = await makeSubject({ name: label("English") }, plus2Coordinator);
    expect((await patch(`/subjects/${id}`, { name: "Hijacked" }, plus2Coordinator)).status).toBe(403);
    expect((await patch(`/subjects/${id}`, { code: label("EN").slice(0, 10) }, coordinator)).status).toBe(200);
    expect((await patch(`/subjects/${id}`, { archived: true }, superAdmin)).status).toBe(200);
  });
});

it("the audit chain is still unbroken", async () => {
  expect(await verifyAuditChain(db, auditKey)).toMatchObject({ ok: true });
});
