import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const db = env.DB;
let counter = 0;
let yearCounter = 2000;
const uniq = (prefix: string) => `${prefix}-${++counter}-${crypto.randomUUID().slice(0, 8)}`;
const at = "2026-09-21T00:00:00.000Z";

async function addYear(status: "draft" | "active" | "closed" = "draft", extra: { start?: string; end?: string; closedAt?: string | null } = {}): Promise<number> {
  const closedAt = extra.closedAt !== undefined ? extra.closedAt : status === "closed" ? at : null;
  const result = await db
    .prepare(
      `INSERT INTO academic_years (public_id, bs_year, label, start_date, end_date, status, created_at, closed_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(uniq("y"), ++yearCounter, uniq("label"), extra.start ?? "2026-04-14", extra.end ?? "2027-04-13", status, at, closedAt)
    .run();
  return result.meta.last_row_id;
}

async function addSection(): Promise<number> {
  const result = await db.prepare("INSERT INTO sections (key, name) VALUES (?1, 'Section')").bind(uniq("sec")).run();
  return result.meta.last_row_id;
}

async function addProgramme(): Promise<number> {
  const sectionId = await addSection();
  const result = await db
    .prepare("INSERT INTO programmes (public_id, key, name, section_id, affiliation) VALUES (?1, ?2, 'Programme', ?3, 'Board')")
    .bind(uniq("p"), uniq("key"), sectionId)
    .run();
  return result.meta.last_row_id;
}

async function addLevel(programmeId: number, ordinal = 1): Promise<number> {
  const result = await db
    .prepare("INSERT INTO levels (public_id, programme_id, ordinal, name) VALUES (?1, ?2, ?3, 'Level')")
    .bind(uniq("l"), programmeId, ordinal)
    .run();
  return result.meta.last_row_id;
}

const addClass = (yearId: number, programmeId: number, levelId: number, label = "") =>
  db
    .prepare("INSERT INTO classes (public_id, academic_year_id, programme_id, level_id, label) VALUES (?1, ?2, ?3, ?4, ?5)")
    .bind(uniq("c"), yearId, programmeId, levelId, label)
    .run();

const addTerminal = (yearId: number, ordinal: number) =>
  db.prepare("INSERT INTO terminals (public_id, academic_year_id, name, ordinal) VALUES (?1, ?2, 'First terminal', ?3)").bind(uniq("t"), yearId, ordinal).run();

// ---------------------------------------------------------------------------------------------
describe("academic_years", () => {
  it("allows only one active year", async () => {
    await addYear("active");
    await expect(addYear("active")).rejects.toThrow(/UNIQUE/);
    await addYear("draft"); // drafts are not limited
  });

  it("refuses a year that does not end after it starts", async () => {
    await expect(addYear("draft", { start: "2027-04-13", end: "2027-04-13" })).rejects.toThrow(/CHECK/);
    await expect(addYear("draft", { start: "2027-04-14", end: "2027-04-13" })).rejects.toThrow(/CHECK/);
  });

  it("refuses a date that is not written YYYY-MM-DD", async () => {
    await expect(addYear("draft", { start: "14/04/2026" })).rejects.toThrow(/CHECK/);
  });

  it("closed_at is set exactly when the year is closed", async () => {
    await expect(addYear("closed", { closedAt: null })).rejects.toThrow(/CHECK/);
    await expect(addYear("draft", { closedAt: at })).rejects.toThrow(/CHECK/);
  });

  it("a closed year cannot be changed at all", async () => {
    const id = await addYear("closed");
    await expect(db.prepare("UPDATE academic_years SET label = 'new' WHERE id = ?1").bind(id).run()).rejects.toThrow(/academic year is closed/);
    await expect(db.prepare("UPDATE academic_years SET status = 'draft', closed_at = NULL WHERE id = ?1").bind(id).run()).rejects.toThrow(/academic year is closed/);
  });

  it("a draft year can be edited and can become active, then closed", async () => {
    const id = await addYear("draft");
    await db.prepare("UPDATE academic_years SET label = 'edited' WHERE id = ?1").bind(id).run();
    await db.prepare("UPDATE academic_years SET status = 'closed', closed_at = ?2 WHERE id = ?1").bind(id, at).run();
  });
});

// ---------------------------------------------------------------------------------------------
describe("classes", () => {
  it("takes a level together with that level's own programme", async () => {
    const yearId = await addYear();
    const programmeId = await addProgramme();
    const levelId = await addLevel(programmeId);
    await addClass(yearId, programmeId, levelId);
  });

  it("refuses a level paired with another programme", async () => {
    const yearId = await addYear();
    const programmeA = await addProgramme();
    const programmeB = await addProgramme();
    const levelOfA = await addLevel(programmeA);
    await expect(addClass(yearId, programmeB, levelOfA)).rejects.toThrow(/FOREIGN KEY/);
  });

  it("refuses the same class twice, including two with no label", async () => {
    const yearId = await addYear();
    const programmeId = await addProgramme();
    const levelId = await addLevel(programmeId);
    await addClass(yearId, programmeId, levelId, "");
    await expect(addClass(yearId, programmeId, levelId, "")).rejects.toThrow(/UNIQUE/);
    await addClass(yearId, programmeId, levelId, "Morning"); // a different label is a different class
    await expect(addClass(yearId, programmeId, levelId, "Morning")).rejects.toThrow(/UNIQUE/);
  });

  it("the same level in another year is another class", async () => {
    const programmeId = await addProgramme();
    const levelId = await addLevel(programmeId);
    await addClass(await addYear(), programmeId, levelId);
    await addClass(await addYear(), programmeId, levelId);
  });

  it("a closed year refuses a new class, a change, and a removal, whatever the service does", async () => {
    const programmeId = await addProgramme();
    const levelId = await addLevel(programmeId);
    const openYear = await addYear();
    await addClass(openYear, programmeId, levelId);
    const classId = (await db.prepare("SELECT id FROM classes WHERE academic_year_id = ?1").bind(openYear).first<{ id: number }>())!.id;
    await db.prepare("UPDATE academic_years SET status = 'closed', closed_at = ?2 WHERE id = ?1").bind(openYear, at).run();

    await expect(addClass(openYear, programmeId, await addLevel(programmeId, 2))).rejects.toThrow(/academic year is closed/);
    await expect(db.prepare("UPDATE classes SET label = 'x' WHERE id = ?1").bind(classId).run()).rejects.toThrow(/academic year is closed/);
    await expect(db.prepare("DELETE FROM classes WHERE id = ?1").bind(classId).run()).rejects.toThrow(/academic year is closed/);
  });

  it("a class cannot be moved into a closed year", async () => {
    const programmeId = await addProgramme();
    const levelId = await addLevel(programmeId);
    const open = await addYear();
    const closed = await addYear("closed");
    await addClass(open, programmeId, levelId);
    const classId = (await db.prepare("SELECT id FROM classes WHERE academic_year_id = ?1").bind(open).first<{ id: number }>())!.id;
    await expect(db.prepare("UPDATE classes SET academic_year_id = ?2 WHERE id = ?1").bind(classId, closed).run()).rejects.toThrow(/academic year is closed/);
  });
});

// ---------------------------------------------------------------------------------------------
describe("levels", () => {
  it("are ordered, and an ordinal is used once per programme", async () => {
    const programmeId = await addProgramme();
    await addLevel(programmeId, 1);
    await addLevel(programmeId, 2);
    await expect(addLevel(programmeId, 2)).rejects.toThrow(/UNIQUE/);
    await addLevel(await addProgramme(), 2); // another programme may reuse it
  });

  it("refuses an ordinal outside 1 to 20", async () => {
    const programmeId = await addProgramme();
    await expect(addLevel(programmeId, 0)).rejects.toThrow(/CHECK/);
    await expect(addLevel(programmeId, 21)).rejects.toThrow(/CHECK/);
  });
});

// ---------------------------------------------------------------------------------------------
describe("terminals", () => {
  it("an ordinal is used once per year", async () => {
    const yearId = await addYear();
    await addTerminal(yearId, 1);
    await expect(addTerminal(yearId, 1)).rejects.toThrow(/UNIQUE/);
    await addTerminal(await addYear(), 1);
  });

  it("a closed year refuses a new terminal, a change, and a removal", async () => {
    const yearId = await addYear();
    await addTerminal(yearId, 1);
    const terminalId = (await db.prepare("SELECT id FROM terminals WHERE academic_year_id = ?1").bind(yearId).first<{ id: number }>())!.id;
    await db.prepare("UPDATE academic_years SET status = 'closed', closed_at = ?2 WHERE id = ?1").bind(yearId, at).run();

    await expect(addTerminal(yearId, 2)).rejects.toThrow(/academic year is closed/);
    await expect(db.prepare("UPDATE terminals SET name = 'x' WHERE id = ?1").bind(terminalId).run()).rejects.toThrow(/academic year is closed/);
    await expect(db.prepare("DELETE FROM terminals WHERE id = ?1").bind(terminalId).run()).rejects.toThrow(/academic year is closed/);
  });
});

describe("programmes", () => {
  it("the key is unique and names are required", async () => {
    const sectionId = await addSection();
    const key = uniq("key");
    const insert = (name: string, k: string) =>
      db.prepare("INSERT INTO programmes (public_id, key, name, section_id, affiliation) VALUES (?1, ?2, ?3, ?4, 'Board')").bind(uniq("p"), k, name, sectionId).run();
    await insert("First", key);
    await expect(insert("Second", key)).rejects.toThrow(/UNIQUE/);
    await expect(insert("", uniq("key"))).rejects.toThrow(/CHECK/);
  });
});
