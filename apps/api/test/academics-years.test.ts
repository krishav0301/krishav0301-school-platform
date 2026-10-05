import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { adToBs, bsToAd, daysInMonth } from "../src/core/dates";
import { newPublicId } from "../src/core/ids";
import { termLengthMonths } from "../src/modules/academics/term-length";
import { activateYear, addLevel, closeCheck, closeYear, createClass, createProgramme, createTerminal, createYear, proposeNextTerm, updateYear } from "../src/modules/academics/service";
import { auditActions, auditKey, count, db, person, seedSections, type Person } from "./academics-helpers";
import { enrol } from "./schoolday-helpers";

/**
 * Academic terms (D-109, D-110), written from the PM's rules: a term is any period the Principal sets, with its dates and
 * the levels it runs; several can be open at once, but a level is in only one open term; a term closes only when every
 * class with students has its results published for every exam, and then refuses every write; the next term is filled
 * in for the Principal to confirm. The code still says "year".
 */

let bs = 2010;
/** A BS year not used yet in this file: its first and last day, from the verified calendar. */
const freshYear = (over: Record<string, unknown> = {}) => {
  const bsYear = ++bs;
  return {
    // Days given by the test say their own BS year.
    ...(over.startDate ? {} : { bsYear }),
    startDate: bsToAd({ year: bsYear, month: 1, day: 1 }),
    endDate: bsToAd({ year: bsYear, month: 12, day: daysInMonth(bsYear, 12) }),
    ...over,
  } as { bsYear?: number; startDate: string; endDate: string; label?: string; code?: string; levelIds?: string[] };
};

let principal: Person, coordinator: Person, sectionCoordinator: Person, accountant: Person, teacher: Person, student: Person, superAdmin: Person;
beforeAll(async () => {
  await seedSections();
  principal = await person("admin", "institution");
  coordinator = await person("coordinator", "institution");
  sectionCoordinator = await person("coordinator", "section", "plus2");
  accountant = await person("accountant", "institution");
  teacher = await person("teacher", "assigned");
  student = await person("student", "own");
  superAdmin = await person("super_admin", "institution");
});

const years = () => count("SELECT COUNT(*) AS n FROM academic_years");
const audits = () => count("SELECT COUNT(*) AS n FROM audit_events");
const levelsOf = (termId: string) => count("SELECT COUNT(*) AS n FROM term_levels tl JOIN academic_years ay ON ay.id = tl.academic_year_id WHERE ay.public_id = ?1", termId);

/** A programme with `n` levels, each lasting `months` (the Principal's ladder): 12 by default, the length of `freshYear`. */
async function ladder(n: number, months: number | null = 12): Promise<string[]> {
  const p = await createProgramme(db, auditKey, principal.publicId, { name: `Programme ${newPublicId().slice(0, 6)}`, sectionKey: "bachelors", affiliation: "Board" });
  if (!p.ok) throw new Error("programme setup failed");
  const ids: string[] = [];
  for (let i = 1; i <= n; i++) {
    const l = await addLevel(db, auditKey, principal.publicId, p.publicId, { name: `Semester ${i}`, ...(months ? { usualMonths: months } : {}) } as never);
    if (!l.ok) throw new Error("level setup failed");
    ids.push(l.publicId);
  }
  return ids;
}

async function term(over: Record<string, unknown> = {}): Promise<string> {
  const r = await createYear(db, auditKey, principal.publicId, freshYear(over));
  if (!r.ok) throw new Error(`term setup failed: ${JSON.stringify(r)}`);
  return r.publicId;
}

// ---------------------------------------------------------------------------------------------
describe("making a term", () => {
  it("the Principal adds a draft term with its levels, named after its BS year, with a receipt code, and it is recorded", async () => {
    const levels = await ladder(2);
    const input = freshYear({ levelIds: levels });
    const result = await createYear(db, auditKey, principal.publicId, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = await db.prepare("SELECT bs_year, code, label, start_date, end_date, status FROM academic_years WHERE public_id = ?1").bind(result.publicId).first();
    expect(row).toEqual({ bs_year: input.bsYear, code: String(input.bsYear), label: String(input.bsYear), start_date: input.startDate, end_date: input.endDate, status: "draft" });
    expect(await levelsOf(result.publicId)).toBe(2);
    expect(await auditActions(result.publicId)).toEqual(["academics.year.created"]);
  });

  it("any length: a 3-month quarter and a 6-month semester in one BS year, each with its own name and the next free receipt code", async () => {
    const bsYear = ++bs;
    const quarter = await createYear(db, auditKey, principal.publicId, {
      label: `MBA Quarter ${bsYear}`,
      startDate: bsToAd({ year: bsYear, month: 4, day: 1 }),
      endDate: bsToAd({ year: bsYear, month: 6, day: daysInMonth(bsYear, 6) }),
    });
    const semester = await createYear(db, auditKey, principal.publicId, {
      label: `Odd semester ${bsYear}`,
      startDate: bsToAd({ year: bsYear, month: 4, day: 1 }),
      endDate: bsToAd({ year: bsYear, month: 9, day: daysInMonth(bsYear, 9) }),
    });
    expect(quarter.ok && semester.ok).toBe(true);
    const codes = (await db.prepare("SELECT code FROM academic_years WHERE bs_year = ?1 ORDER BY id").bind(bsYear).all<{ code: string }>()).results.map((r) => r.code);
    expect(codes).toEqual([String(bsYear), `${bsYear}B`]);
  });

  it("the Super Admin may too; a code of one's own is upper-cased", async () => {
    const r = await createYear(db, auditKey, superAdmin.publicId, freshYear({ code: "mba1q" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(await db.prepare("SELECT code FROM academic_years WHERE public_id = ?1").bind(r.publicId).first()).toEqual({ code: "MBA1Q" });
  });

  const bad: [string, () => Record<string, unknown>, RegExp][] = [
    ["days outside the verified calendar", () => ({ startDate: "2033-04-14", endDate: "2034-04-13" }), /verified/],
    ["a BS year the start day is not in", () => { const f = freshYear(); return { ...f, bsYear: f.bsYear! + 1 }; }, /not in BS/],
    ["an end that is not after the start", () => { const f = freshYear(); return { ...f, endDate: f.startDate }; }, /end after/i],
    ["a day that does not exist", () => ({ ...freshYear(), startDate: "2026-02-30" }), /does not exist/],
    ["an empty name", () => ({ ...freshYear(), label: "  " }), /name/i],
    ["a receipt code with a dash", () => ({ ...freshYear(), code: "20-83" }), /receipt code/],
    ["a level that does not exist", () => ({ ...freshYear(), levelIds: ["0".repeat(32)] }), /levels/],
    ["a field that is not allowed (the status)", () => ({ ...freshYear(), status: "active" }), /./],
  ];
  it.each(bad)("refuses %s, and writes nothing", async (_label, make, message) => {
    const before = [await years(), await audits()];
    const result = await createYear(db, auditKey, principal.publicId, make() as never);
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect((result as { message: string }).message).toMatch(message);
    expect([await years(), await audits()]).toEqual(before);
  });

  it("refuses everyone but the Principal and the Super Admin (the Co-ordinator too, since D-110), and writes nothing", async () => {
    const before = [await years(), await audits()];
    for (const [name, who] of [["co-ordinator", coordinator], ["+2 co-ordinator", sectionCoordinator], ["accountant", accountant], ["teacher", teacher], ["student", student]] as const) {
      expect(await createYear(db, auditKey, who.publicId, freshYear()), name).toEqual({ ok: false, reason: "not_allowed" });
    }
    expect([await years(), await audits()]).toEqual(before);
  });

  it("re-checks the person in the database: a switched-off Admin is refused even with a valid token", async () => {
    const off = await person("admin", "institution");
    await db.prepare("UPDATE users SET is_active = 0 WHERE public_id = ?1").bind(off.publicId).run();
    expect(await createYear(db, auditKey, off.publicId, freshYear())).toEqual({ ok: false, reason: "not_allowed" });
  });

  it("a name already used is a conflict and leaves no false audit entry", async () => {
    await term({ label: "Same name" });
    const before = await audits();
    expect(await createYear(db, auditKey, principal.publicId, freshYear({ label: "Same name" }))).toEqual({ ok: false, reason: "conflict" });
    expect(await audits()).toBe(before);
  });
});

// ---------------------------------------------------------------------------------------------
describe("one open term per level", () => {
  it("a level already in an open term is refused for another, and nothing is written; once that term closes, it is free", async () => {
    const [sem1] = await ladder(1);
    const first = await term({ levelIds: [sem1] });
    const before = [await years(), await audits()];
    expect(await createYear(db, auditKey, principal.publicId, freshYear({ levelIds: [sem1] }))).toMatchObject({ ok: false, reason: "invalid", message: expect.stringMatching(/another open term/) });
    expect([await years(), await audits()]).toEqual(before);

    expect(await activateYear(db, auditKey, principal.publicId, first)).toEqual({ ok: true });
    expect(await closeYear(db, auditKey, principal.publicId, first)).toEqual({ ok: true }); // no classes: nothing to wait for
    expect((await createYear(db, auditKey, principal.publicId, freshYear({ levelIds: [sem1] }))).ok).toBe(true);
  });

  it("several terms can be open at once (the odd semesters beside a +2 year)", async () => {
    const a = await term({ levelIds: await ladder(1) });
    const b = await term({ levelIds: await ladder(1) });
    const results = await Promise.all([activateYear(db, auditKey, principal.publicId, a), activateYear(db, auditKey, principal.publicId, b)]);
    expect(results).toEqual([{ ok: true }, { ok: true }]);
    expect(await auditActions(a)).toContain("academics.year.activated");
    expect(await auditActions(b)).toContain("academics.year.activated");
    // Already open: a repeat says so, and records nothing more.
    const before = await audits();
    expect(await activateYear(db, auditKey, principal.publicId, a)).toEqual({ ok: false, reason: "not_draft" });
    expect(await audits()).toBe(before);
    expect(await activateYear(db, auditKey, coordinator.publicId, a)).toEqual({ ok: false, reason: "not_allowed" });
    expect(await activateYear(db, auditKey, principal.publicId, "0".repeat(32))).toEqual({ ok: false, reason: "not_found" });
  });

  it("a class is only for a level its term runs: the Co-ordinator is told the Principal adds it", async () => {
    const [inTerm, outside] = await ladder(2);
    const t = await term({ levelIds: [inTerm] });
    expect((await createClass(db, auditKey, coordinator.publicId, { yearId: t, levelId: inTerm! })).ok).toBe(true);
    expect(await createClass(db, auditKey, coordinator.publicId, { yearId: t, levelId: outside! })).toMatchObject({ ok: false, reason: "invalid", message: expect.stringMatching(/Principal/) });
  });
});

// ---------------------------------------------------------------------------------------------
describe("changing a term", () => {
  it("the name and days while it is a draft, recorded before and after; changing nothing records nothing", async () => {
    const id = await term();
    expect(await updateYear(db, auditKey, principal.publicId, id, { label: "Renamed term" })).toEqual({ ok: true });
    expect(await db.prepare("SELECT label FROM academic_years WHERE public_id = ?1").bind(id).first()).toEqual({ label: "Renamed term" });
    expect(await auditActions(id)).toEqual(["academics.year.created", "academics.year.updated"]);
    const before = await audits();
    expect(await updateYear(db, auditKey, principal.publicId, id, {})).toEqual({ ok: true });
    expect(await audits()).toBe(before);
    const start = (await db.prepare("SELECT start_date FROM academic_years WHERE public_id = ?1").bind(id).first<{ start_date: string }>())!.start_date;
    expect(await updateYear(db, auditKey, principal.publicId, id, { endDate: start })).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("the levels while it is open; a level with classes in it stays", async () => {
    const [a, b] = await ladder(2);
    const id = await term({ levelIds: [a] });
    await activateYear(db, auditKey, principal.publicId, id);
    expect(await updateYear(db, auditKey, principal.publicId, id, { label: "Not while open" })).toEqual({ ok: false, reason: "not_draft" });
    expect(await updateYear(db, auditKey, principal.publicId, id, { levelIds: [a!, b!] })).toEqual({ ok: true });
    expect(await levelsOf(id)).toBe(2);
    expect((await createClass(db, auditKey, coordinator.publicId, { yearId: id, levelId: a! })).ok).toBe(true);
    expect(await updateYear(db, auditKey, principal.publicId, id, { levelIds: [b!] })).toMatchObject({ ok: false, reason: "invalid", message: expect.stringMatching(/has classes/) });
    expect(await levelsOf(id)).toBe(2);
    expect(await updateYear(db, auditKey, principal.publicId, id, { levelIds: [a!] })).toEqual({ ok: true });
    expect(await levelsOf(id)).toBe(1);
  });

  it("refuses an unknown term, anyone but the Principal, and a closed term", async () => {
    expect(await updateYear(db, auditKey, principal.publicId, "0".repeat(32), { label: "x" })).toEqual({ ok: false, reason: "not_found" });
    const id = await term();
    expect(await updateYear(db, auditKey, coordinator.publicId, id, { label: "x" })).toEqual({ ok: false, reason: "not_allowed" });
    await db.prepare("UPDATE academic_years SET status = 'closed', closed_at = '2026-09-21T00:00:00Z' WHERE public_id = ?1").bind(id).run();
    expect(await updateYear(db, auditKey, principal.publicId, id, { label: "x" })).toEqual({ ok: false, reason: "year_closed" });
  });
});

// ---------------------------------------------------------------------------------------------
describe("closing a term", () => {
  it("is refused until every class with students has its results published for every exam; then the term refuses writes", async () => {
    const [level] = await ladder(1);
    const id = await term({ levelIds: [level] });
    await activateYear(db, auditKey, principal.publicId, id);
    const cls = await createClass(db, auditKey, coordinator.publicId, { yearId: id, levelId: level! });
    if (!cls.ok) throw new Error("class setup failed");
    await enrol(cls.publicId, "Closer");

    // No exams yet: a class with students has nothing published, so the term is not ready.
    expect(await closeCheck(db, id)).toMatchObject({ ready: false, exams: 0, classes: 1, missing: [{ classId: cls.publicId, examId: null }] });
    const exam = await createTerminal(db, auditKey, coordinator.publicId, { yearId: id, name: "Final" });
    if (!exam.ok) throw new Error("exam setup failed");
    const refused = await closeYear(db, auditKey, principal.publicId, id);
    expect(refused).toMatchObject({ ok: false, reason: "not_ready", check: { ready: false, missing: [{ classId: cls.publicId, examId: exam.publicId, examName: "Final" }] } });
    expect(await db.prepare("SELECT status FROM academic_years WHERE public_id = ?1").bind(id).first()).toEqual({ status: "active" });

    // Published (the results module's own write, made directly here): now it closes, once.
    await db
      .prepare(
        `INSERT INTO result_publications (public_id, class_id, terminal_id, grading_policy, published_by_user_id, published_at)
         SELECT ?1, c.id, t.id, 'percentage_division', u.id, '2026-09-30T00:00:00Z' FROM classes c, terminals t, users u WHERE c.public_id = ?2 AND t.public_id = ?3 AND u.public_id = ?4`,
      )
      .bind(newPublicId(), cls.publicId, exam.publicId, coordinator.publicId)
      .run();
    expect(await closeCheck(db, id)).toMatchObject({ ready: true, missing: [] });
    expect(await closeYear(db, auditKey, coordinator.publicId, id)).toEqual({ ok: false, reason: "not_allowed" });
    expect(await closeYear(db, auditKey, principal.publicId, id)).toEqual({ ok: true });
    expect(await auditActions(id)).toContain("academics.year.closed");
    expect(await closeYear(db, auditKey, principal.publicId, id)).toEqual({ ok: false, reason: "year_closed" });
    // Closed refuses every write.
    expect(await createClass(db, auditKey, coordinator.publicId, { yearId: id, levelId: level!, label: "Late" })).toEqual({ ok: false, reason: "year_closed" });
    expect(await createTerminal(db, auditKey, coordinator.publicId, { yearId: id, name: "Another" })).toEqual({ ok: false, reason: "year_closed" });
  });

  it("a draft term is opened before it is closed", async () => {
    const id = await term();
    expect(await closeYear(db, auditKey, principal.publicId, id)).toMatchObject({ ok: false, reason: "invalid" });
  });
});

// ---------------------------------------------------------------------------------------------
describe("the next term, filled in", () => {
  it("proposes the next level of each batch, starting the day after, for the levels' usual length; flags a level another open term has", async () => {
    const sems = await ladder(4, 6);
    const bsYear = ++bs;
    const id = await term({ label: `Odd ${bsYear}`, startDate: bsToAd({ year: bsYear, month: 4, day: 1 }), endDate: bsToAd({ year: bsYear, month: 9, day: daysInMonth(bsYear, 9) }), levelIds: [sems[0], sems[2]] });
    for (const level of [sems[0]!, sems[2]!]) {
      const cls = await createClass(db, auditKey, coordinator.publicId, { yearId: id, levelId: level });
      if (!cls.ok) throw new Error("class setup failed");
      await enrol(cls.publicId, "Batch");
    }
    // Semester 4 already runs in another open term.
    const other = await term({ label: `Other ${bsYear}`, startDate: bsToAd({ year: bsYear, month: 4, day: 1 }), endDate: bsToAd({ year: bsYear, month: 9, day: daysInMonth(bsYear, 9) }), levelIds: [sems[3]] });

    const next = await proposeNextTerm(db, id);
    expect(next).not.toBeNull();
    expect(next!.levels.map((l) => [l.id, l.takenBy])).toEqual([
      [sems[1], null],
      [sems[3], `Other ${bsYear}`],
    ]);
    // Magh 1 to Asar's last day: six BS months.
    expect(next!.startDate).toBe(bsToAd({ year: bsYear, month: 10, day: 1 }));
    expect(adToBs(next!.endDate)).toEqual({ year: bsYear + 1, month: 3, day: daysInMonth(bsYear + 1, 3) });
    expect(next!.label).toMatch(/Magh/);
    expect(next!.code).toMatch(/^\d{4}[A-Z]?$/);
    expect(other).toBeTruthy();
    expect(await proposeNextTerm(db, "0".repeat(32))).toBeNull();
  });
});

it("the audit chain is still unbroken", async () => {
  expect(await verifyAuditChain(db, auditKey)).toMatchObject({ ok: true });
});

// ---------------------------------------------------------------------------------------------
describe("a term runs only levels of its own length (D-114)", () => {
  /** A term from the first of `fromMonth` to the last day of `toMonth`, in a BS year not used yet. */
  const span = (fromMonth: number, toMonth: number, over: Record<string, unknown> = {}) => {
    const bsYear = ++bs;
    return { label: `Span ${bsYear}`, startDate: bsToAd({ year: bsYear, month: fromMonth, day: 1 }), endDate: bsToAd({ year: bsYear, month: toMonth, day: daysInMonth(bsYear, toMonth) }), ...over };
  };
  const noLength = async (levelId: string) => db.prepare("UPDATE levels SET usual_months = NULL WHERE public_id = ?1").bind(levelId).run();

  it("counts a term's length in whole months on the BS calendar, rounding a few days either way", () => {
    expect(termLengthMonths(bsToAd({ year: 2082, month: 4, day: 1 }), bsToAd({ year: 2082, month: 9, day: daysInMonth(2082, 9) }))).toBe(6);
    expect(termLengthMonths(bsToAd({ year: 2082, month: 4, day: 1 }), bsToAd({ year: 2082, month: 9, day: daysInMonth(2082, 9) - 3 }))).toBe(6); // a few days short
    expect(termLengthMonths(bsToAd({ year: 2082, month: 1, day: 1 }), bsToAd({ year: 2082, month: 12, day: daysInMonth(2082, 12) }))).toBe(12);
    expect(termLengthMonths(bsToAd({ year: 2082, month: 10, day: 15 }), bsToAd({ year: 2083, month: 1, day: 14 }))).toBe(3); // across the BS new year
  });

  it("refuses a 3-month level in a 6-month term, naming both lengths, and writes nothing", async () => {
    const [quarter] = await ladder(1, 3);
    const before = [await years(), await audits()];
    expect(await createYear(db, auditKey, principal.publicId, span(4, 9, { levelIds: [quarter] }))).toMatchObject({ ok: false, reason: "invalid", message: expect.stringMatching(/3 months.*6 months/) });
    expect([await years(), await audits()]).toEqual(before);
  });

  it("refuses a level whose length is not set yet", async () => {
    const [level] = await ladder(1, 6);
    await noLength(level!);
    expect(await createYear(db, auditKey, principal.publicId, span(4, 9, { levelIds: [level] }))).toMatchObject({ ok: false, reason: "invalid", message: expect.stringMatching(/Set the length/) });
  });

  it("accepts a level of the term's length", async () => {
    const [sem] = await ladder(1, 6);
    const r = await createYear(db, auditKey, principal.publicId, span(4, 9, { levelIds: [sem] }));
    expect(r.ok).toBe(true);
  });

  it("an open term already holding a mismatched level still takes a matching one (flagged, not blocked)", async () => {
    const [a, b] = await ladder(2, 12);
    const id = await term({ levelIds: [a] });
    await db.prepare("UPDATE levels SET usual_months = 3 WHERE public_id = ?1").bind(a).run(); // the Admin changed it later
    expect(await updateYear(db, auditKey, principal.publicId, id, { levelIds: [a!, b!] })).toEqual({ ok: true });
    expect(await levelsOf(id)).toBe(2);
  });

  it("refuses new days for a draft term when a level it runs would no longer fit", async () => {
    const [sem] = await ladder(1, 6);
    const created = await createYear(db, auditKey, principal.publicId, span(4, 9, { levelIds: [sem] }));
    if (!created.ok) throw new Error("term setup failed");
    const year = adToBs(bsToAd({ year: bs, month: 4, day: 1 })).year;
    const longer = { endDate: bsToAd({ year, month: 12, day: daysInMonth(year, 12) }) };
    expect(await updateYear(db, auditKey, principal.publicId, created.publicId, longer)).toMatchObject({ ok: false, reason: "invalid", message: expect.stringMatching(/6 months.*9 months/) });
  });

  it("the term list says how long each term is and each level's length", async () => {
    const [sem] = await ladder(1, 6);
    const created = await createYear(db, auditKey, principal.publicId, span(4, 9, { levelIds: [sem] }));
    if (!created.ok) throw new Error("term setup failed");
    const { listYears } = await import("../src/modules/academics/queries");
    const listed = (await listYears(db)).years.find((y) => y.id === created.publicId)!;
    expect(listed.months).toBe(6);
    expect(listed.levels.map((l) => l.usualMonths)).toEqual([6]);
  });
});
