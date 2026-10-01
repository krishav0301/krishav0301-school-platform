import { beforeAll, describe, expect, it } from "vitest";

import { call, person, seedSections, type Person, programmesAdmin } from "./academics-helpers";

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

const get = (who?: Person) => call("/api/academics/checklist", { cookie: who?.cookie });

interface Checklist {
  year: boolean;
  structure: boolean;
  classes: boolean;
  terminals: boolean;
  subjects: boolean;
  teachers: boolean;
  classTeachers: boolean;
}

// ---------------------------------------------------------------------------------------------
describe("who may read the setup checklist", () => {
  it("nobody who is signed out: 401", async () => {
    expect((await get()).status).toBe(401);
  });

  it("students, teachers and accountants: 403", async () => {
    for (const who of [student, teacher, accountant]) expect((await get(who)).status).toBe(403);
  });

  it("the Co-ordinator (whole institution and section-scoped), the Admin and the Super Admin may read it", async () => {
    for (const who of [coordinator, plus2Coordinator, bachelorsCoordinator, admin, superAdmin]) expect((await get(who)).status).toBe(200);
  });

  it("is never cached", async () => {
    expect((await get(coordinator)).headers.get("Cache-Control")).toBe("no-store");
  });
});

// ---------------------------------------------------------------------------------------------
describe("what the checklist shows", () => {
  it("a section-scoped Co-ordinator's structure reflects only their own section", async () => {
    const before = (await (await get(plus2Coordinator)).json()) as Checklist;

    const programme = await call("/api/academics/programmes", { method: "POST", body: { name: "Bachelors only", sectionKey: "bachelors", affiliation: "TU" }, cookie: (await programmesAdmin()).cookie });
    expect(programme.status).toBe(201);
    const { id: programmeId } = (await programme.json()) as { id: string };
    const level = await call(`/api/academics/programmes/${programmeId}/levels`, { method: "POST", body: { name: "Year 1" }, cookie: (await programmesAdmin()).cookie });
    expect(level.status).toBe(201);

    const afterPlus2 = (await (await get(plus2Coordinator)).json()) as Checklist;
    expect(afterPlus2.structure, "a Bachelor's-only programme does not affect the +2 Co-ordinator's view").toBe(before.structure);
    const afterBachelors = (await (await get(bachelorsCoordinator)).json()) as Checklist;
    expect(afterBachelors.structure, "but it does count for the Bachelor's Co-ordinator").toBe(true);
    const afterWhole = (await (await get(coordinator)).json()) as Checklist;
    expect(afterWhole.structure, "and for the whole-institution view").toBe(true);
  });
});
