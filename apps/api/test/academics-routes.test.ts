import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { bsToAd, daysInMonth } from "../src/core/dates";
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

let bs = 2010;
const yearBody = () => {
  const bsYear = ++bs;
  return { bsYear, startDate: bsToAd({ year: bsYear, month: 1, day: 1 }), endDate: bsToAd({ year: bsYear, month: 12, day: daysInMonth(bsYear, 12) }) };
};

const post = (path: string, body: unknown, who: Person) => call(`/api/academics${path}`, { method: "POST", body, cookie: who.cookie });
const patch = (path: string, body: unknown, who: Person) => call(`/api/academics${path}`, { method: "PATCH", body, cookie: who.cookie });
const get = (path: string, who: Person) => call(`/api/academics${path}`, { cookie: who.cookie });
const idOf = async (response: Response) => ((await response.json()) as { id: string }).id;

/** The Principal makes a term (D-110), with the levels it runs. */
async function makeYear(levelIds: string[] = [], who: Person = admin) {
  const response = await post("/years", { ...yearBody(), levelIds }, who);
  expect(response.status).toBe(201);
  return idOf(response);
}
async function makeProgramme(sectionKey: "plus2" | "bachelors", who?: Person) {
  who ??= await programmesAdmin();
  const response = await post("/programmes", { name: `${sectionKey} programme`, sectionKey, affiliation: "Board" }, who);
  expect(response.status).toBe(201);
  const programmeId = await idOf(response);
  const level = await post(`/programmes/${programmeId}/levels`, { name: "Level 1" }, who);
  expect(level.status).toBe(201);
  return { programmeId, levelId: await idOf(level) };
}

const noId = "0".repeat(32);
const reads = ["/years", "/programmes", "/classes", "/terminals"];
/** Terms: the Principal's alone (D-110). */
const termWrites: [string, string, unknown][] = [
  ["POST", "/years", yearBody()],
  ["PATCH", `/years/${noId}`, { label: "x" }],
  ["POST", `/years/${noId}/activate`, undefined],
  ["POST", `/years/${noId}/close`, undefined],
];
/** Classes and exams in a term: the Co-ordinator's. */
const writes: [string, string, unknown][] = [
  ["POST", "/classes", { yearId: noId, levelId: noId }],
  ["PATCH", `/classes/${noId}`, { label: "x" }],
  ["PUT", `/years/${noId}/exam-pattern`, { graded: false, theoryMinPercent: 35, practicalMinPercent: 40, gradeBands: null, terminals: [{ name: "x", weight: 100, hasPractical: false }] }],
];
/** Programmes and their levels: the Admin's alone (D-087). */
const programmeWrites: [string, string, unknown][] = [
  ["POST", "/programmes", { name: "x", sectionKey: "plus2", affiliation: "y" }],
  ["PATCH", `/programmes/${noId}`, { name: "x" }],
  ["POST", `/programmes/${noId}/levels`, { name: "x" }],
  ["PATCH", `/levels/${noId}`, { name: "x" }],
];

// ---------------------------------------------------------------------------------------------
describe("who may use the academic routes", () => {
  it("nobody who is signed out: 401 everywhere, and a garbage body is not even looked at", async () => {
    for (const path of reads) expect((await call(`/api/academics${path}`)).status, path).toBe(401);
    for (const [method, path, body] of [...writes, ...termWrites]) expect((await call(`/api/academics${path}`, { method, body })).status, `${method} ${path}`).toBe(401);
    expect((await call("/api/academics/programmes", { method: "POST", body: { nonsense: true } })).status).toBe(401);
  });

  it("students, teachers and accountants: 403 everywhere, and nothing is written", async () => {
    const before = await count("SELECT (SELECT COUNT(*) FROM academic_years) + (SELECT COUNT(*) FROM programmes) AS n");
    for (const who of [student, teacher, accountant]) {
      for (const path of reads) expect((await get(path, who)).status, path).toBe(403);
      for (const [method, path, body] of [...writes, ...termWrites]) expect((await call(`/api/academics${path}`, { method, body, cookie: who.cookie })).status, `${method} ${path}`).toBe(403);
    }
    expect(await count("SELECT (SELECT COUNT(*) FROM academic_years) + (SELECT COUNT(*) FROM programmes) AS n")).toBe(before);
  });

  it("the Principal makes terms (D-110) but does not change classes and exams", async () => {
    for (const path of reads) expect((await get(path, admin)).status, path).toBe(200);
    for (const [method, path, body] of writes) expect((await call(`/api/academics${path}`, { method, body, cookie: admin.cookie })).status, `${method} ${path}`).toBe(403);
    expect((await post("/years", yearBody(), admin)).status).toBe(201);
  });

  it("programmes and levels are the Admin's: every Co-ordinator is refused (403), the Admin reaches the rule (D-087)", async () => {
    for (const who of [coordinator, plus2Coordinator]) {
      for (const [method, path, body] of programmeWrites) expect((await call(`/api/academics${path}`, { method, body, cookie: who.cookie })).status, `${method} ${path}`).toBe(403);
    }
    expect((await post("/programmes", { name: "Science", sectionKey: "plus2", affiliation: "NEB" }, admin)).status).toBe(201);
    expect((await patch(`/programmes/${noId}`, { name: "x" }, admin)).status).toBe(404);
  });

  it("the Co-ordinator may look but not make a term (D-110); the Super Admin may", async () => {
    for (const path of reads) expect((await get(path, coordinator)).status, path).toBe(200);
    for (const [method, path, body] of termWrites) expect((await call(`/api/academics${path}`, { method, body, cookie: coordinator.cookie })).status, `${method} ${path}`).toBe(403);
    expect((await post("/years", yearBody(), superAdmin)).status).toBe(201);
  });

  it("a section-scoped Co-ordinator may look at years and terminals but not make a term or its exam pattern (whole-school facts)", async () => {
    expect((await get("/years", plus2Coordinator)).status).toBe(200);
    expect((await get("/terminals", plus2Coordinator)).status).toBe(200);
    expect((await post("/years", yearBody(), plus2Coordinator)).status).toBe(403);
    const yearId = await makeYear();
    const refused = await call(`/api/academics/years/${yearId}/exam-pattern`, { method: "PUT", body: { graded: false, theoryMinPercent: 35, practicalMinPercent: 40, gradeBands: null, terminals: [{ name: "First", weight: 100, hasPractical: false }] }, cookie: plus2Coordinator.cookie });
    expect(refused.status).toBe(403);
  });

  it("a switched-off Principal with a valid sign-in is refused (403), not served from the token", async () => {
    const off = await person("admin", "institution");
    await db.prepare("UPDATE users SET is_active = 0 WHERE public_id = ?1").bind(off.publicId).run();
    const before = await count("SELECT COUNT(*) AS n FROM academic_years");
    expect((await post("/years", yearBody(), off)).status).toBe(403);
    expect(await count("SELECT COUNT(*) AS n FROM academic_years")).toBe(before);
  });

  it("answers are never cached", async () => {
    expect((await get("/programmes", coordinator)).headers.get("Cache-Control")).toBe("no-store");
  });
});

// ---------------------------------------------------------------------------------------------
describe("setting up a year, end to end", () => {
  it("year, programme, level, class, exam pattern: created, listed, changed, and audited", async () => {
    const { programmeId, levelId } = await makeProgramme("bachelors");
    const yearId = await makeYear([levelId]);

    const activate = await post(`/years/${yearId}/activate`, undefined, admin);
    expect(activate.status).toBe(200);

    const classResponse = await post("/classes", { yearId, levelId, label: "Morning" }, coordinator);
    expect(classResponse.status).toBe(201);
    const classId = await idOf(classResponse);
    const examPattern = (name: string) => ({ graded: false, theoryMinPercent: 35, practicalMinPercent: 40, gradeBands: null, terminals: [{ name, weight: 100, hasPractical: false }] });
    expect((await call(`/api/academics/years/${yearId}/exam-pattern`, { method: "PUT", body: examPattern("First terminal"), cookie: coordinator.cookie })).status).toBe(200);

    const years = (await (await get("/years", coordinator)).json()) as { years: { id: string; status: string; startDate: string; startDateBs: string | null; code: string; levels: { id: string }[]; classes: number }[] };
    const year = years.years.find((y) => y.id === yearId)!;
    expect(year.status).toBe("active");
    expect(year.startDateBs).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(year).toMatchObject({ levels: [{ id: levelId }], classes: 1 });
    expect(year.code).toMatch(/^\d{4}[A-Z]?$/);

    const programmes = (await (await get("/programmes", coordinator)).json()) as { programmes: { id: string; section: { key: string }; levels: { id: string; ordinal: number; name: string; active: boolean }[] }[] };
    const programme = programmes.programmes.find((p) => p.id === programmeId)!;
    expect(programme.section.key).toBe("bachelors");
    expect(programme.levels).toEqual([{ id: levelId, ordinal: 1, name: "Level 1", active: true, usualMonths: null, students: 0, canDelete: false }]); // no one enrolled yet (D-096); its class means it cannot be deleted (D-097)

    const classes = (await (await get(`/classes?year=${yearId}`, coordinator)).json()) as { classes: { id: string; label: string; levelName: string; programmeName: string; active: boolean }[] };
    expect(classes.classes).toMatchObject([{ id: classId, label: "Morning", levelName: "Level 1", active: true }]);
    const terminals = (await (await get(`/terminals?year=${yearId}`, coordinator)).json()) as { terminals: { id: string; name: string; ordinal: number; weight: number }[] };
    expect(terminals.terminals).toMatchObject([{ name: "First terminal", ordinal: 1, weight: 100, hasPractical: false }]);
    const terminalId = terminals.terminals[0]!.id;

    expect((await patch(`/classes/${classId}`, { active: false }, coordinator)).status).toBe(200);
    expect((await patch(`/levels/${levelId}`, { name: "Year 1" }, admin)).status).toBe(200);
    expect((await patch(`/programmes/${programmeId}`, { name: "Renamed" }, admin)).status).toBe(200);
    expect((await call(`/api/academics/years/${yearId}/exam-pattern`, { method: "PUT", body: { ...examPattern("Mid-year"), terminals: [{ id: terminalId, name: "Mid-year", weight: 100, hasPractical: false }] }, cookie: coordinator.cookie })).status).toBe(200);
    expect(await auditActions(yearId)).toEqual(expect.arrayContaining(["academics.exam_pattern.created", "academics.exam_pattern.updated"]));

    expect(await auditActions(classId)).toEqual(["academics.class.created", "academics.class.updated"]);
    const actor = await db.prepare("SELECT u.public_id AS actor FROM audit_events a JOIN users u ON u.id = a.actor_user_id WHERE a.entity_public_id = ?1 LIMIT 1").bind(classId).first<{ actor: string }>();
    expect(actor!.actor).toBe(coordinator.publicId);
  });

  it("status codes for the failure cases: 400 for a bad shape, 422 for a broken rule, 404, and 409", async () => {
    // A body that breaks the request schema.
    expect((await post("/programmes", { name: "x" }, admin)).status).toBe(400);
    expect((await post("/years", { ...yearBody(), status: "active" }, admin)).status).toBe(400);
    // A rule the service checks (days outside the verified calendar).
    const unverified = await post("/years", { startDate: "2033-04-14", endDate: "2034-04-13" }, admin);
    expect(unverified.status).toBe(422);
    expect(await unverified.json()).toMatchObject({ error: "invalid" });
    // Not found.
    expect((await post(`/programmes/${noId}/levels`, { name: "x" }, admin)).status).toBe(404);
    expect((await patch(`/classes/${noId}`, { label: "x" }, coordinator)).status).toBe(404);
    // A repeat class is a conflict; a closed year is a conflict with its own word.
    const { levelId } = await makeProgramme("plus2");
    const yearId = await makeYear([levelId]);
    expect((await post("/classes", { yearId, levelId }, coordinator)).status).toBe(201);
    const duplicate = await post("/classes", { yearId, levelId }, coordinator);
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ error: "conflict" });
    await db.prepare("UPDATE academic_years SET status = 'closed', closed_at = '2026-09-21T00:00:00Z' WHERE public_id = ?1").bind(yearId).run();
    const closed = await post("/classes", { yearId, levelId, label: "Late" }, coordinator);
    expect(closed.status).toBe(409);
    expect(await closed.json()).toEqual({ error: "year_closed" });
    const late = await call(`/api/academics/years/${yearId}/exam-pattern`, { method: "PUT", body: { graded: false, theoryMinPercent: 35, practicalMinPercent: 40, gradeBands: null, terminals: [{ name: "Late", weight: 100, hasPractical: false }] }, cookie: coordinator.cookie });
    expect(late.status).toBe(409);
    expect(await late.json()).toEqual({ error: "year_closed" });
  });

  it("several terms can be open at once (D-110); a term with students but nothing published is 409 not_ready, with the check", async () => {
    const another = await makeYear();
    expect((await post(`/years/${another}/activate`, undefined, admin)).status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM academic_years WHERE status = 'active'")).toBeGreaterThan(1);
    // Nothing in it: it closes at once, and a second close is 409.
    expect((await post(`/years/${another}/close`, undefined, admin)).status).toBe(200);
    expect(await (await post(`/years/${another}/close`, undefined, admin)).json()).toEqual({ error: "year_closed" });
    const check = await get(`/years/${another}/close-check`, admin);
    expect(await check.json()).toMatchObject({ ready: true, missing: [] });
    expect((await get(`/years/${another}/close-check`, coordinator)).status).toBe(403);
    expect((await get(`/years/${noId}/next`, admin)).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------------------------
describe("a section-scoped Co-ordinator gets nothing from the other section (data-level)", () => {
  it("lists only their own section's programmes and classes", async () => {
    const plus2 = await makeProgramme("plus2");
    const bachelors = await makeProgramme("bachelors");
    const yearId = await makeYear([plus2.levelId, bachelors.levelId]);
    await post("/classes", { yearId, levelId: plus2.levelId }, coordinator);
    await post("/classes", { yearId, levelId: bachelors.levelId }, coordinator);

    const seen = async (who: Person) => {
      const programmes = (await (await get("/programmes", who)).json()) as { programmes: { id: string }[] };
      const classes = (await (await get(`/classes?year=${yearId}`, who)).json()) as { classes: { programmeId: string }[] };
      return { programmes: programmes.programmes.map((p) => p.id), classes: classes.classes.map((c) => c.programmeId) };
    };

    const mine = await seen(plus2Coordinator);
    expect(mine.programmes).toContain(plus2.programmeId);
    expect(mine.programmes).not.toContain(bachelors.programmeId);
    expect(mine.classes).toEqual([plus2.programmeId]);

    const theirs = await seen(bachelorsCoordinator);
    expect(theirs.programmes).toContain(bachelors.programmeId);
    expect(theirs.programmes).not.toContain(plus2.programmeId);
    expect(theirs.classes).toEqual([bachelors.programmeId]);

    const all = await seen(coordinator);
    expect(all.programmes).toEqual(expect.arrayContaining([plus2.programmeId, bachelors.programmeId]));
    expect((await seen(admin)).programmes).toEqual(expect.arrayContaining([plus2.programmeId, bachelors.programmeId]));
  });

  it("cannot change the other section's programme, level or classes, even with the right ids", async () => {
    const bachelors = await makeProgramme("bachelors");
    const yearId = await makeYear([bachelors.levelId]);
    const classId = await idOf(await post("/classes", { yearId, levelId: bachelors.levelId }, coordinator));

    expect((await patch(`/programmes/${bachelors.programmeId}`, { name: "Hijacked" }, plus2Coordinator)).status).toBe(403);
    expect((await post(`/programmes/${bachelors.programmeId}/levels`, { name: "Year 2" }, plus2Coordinator)).status).toBe(403);
    expect((await patch(`/levels/${bachelors.levelId}`, { name: "Hijacked" }, plus2Coordinator)).status).toBe(403);
    expect((await post("/classes", { yearId, levelId: bachelors.levelId, label: "Evening" }, plus2Coordinator)).status).toBe(403);
    expect((await patch(`/classes/${classId}`, { active: false }, plus2Coordinator)).status).toBe(403);
    expect((await post("/programmes", { name: "Sneaky", sectionKey: "bachelors", affiliation: "TU" }, plus2Coordinator)).status).toBe(403);

    expect(await db.prepare("SELECT name FROM programmes WHERE public_id = ?1").bind(bachelors.programmeId).first()).toEqual({ name: "bachelors programme" });
    expect(await db.prepare("SELECT is_active FROM classes WHERE public_id = ?1").bind(classId).first()).toEqual({ is_active: 1 });
  });
});

it("the audit chain is still unbroken", async () => {
  expect(await verifyAuditChain(db, auditKey)).toMatchObject({ ok: true });
});
