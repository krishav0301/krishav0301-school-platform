import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { bsToAd, daysInMonth } from "../src/core/dates";
import { newPublicId } from "../src/core/ids";
import { verifyLedgerChain } from "../src/modules/fees/ledger";
import { billingSchedule, termMonths } from "../src/modules/fees/policy";
import { auditKey, call, count, db, person, seedSections, type Person } from "./academics-helpers";

/**
 * A semester school through the real routes (D-109, D-110): the Principal makes a semester term beside a yearly one, the
 * Co-ordinator sets up classes and admits students, the Accountant bills and takes a payment, the Principal closes the
 * term once results are published and fills in the next one, and the Co-ordinator moves each student on. Written from
 * the PM's rules: a level is in only one open term; closing waits for every result; leaving needs nothing owed; what is
 * owed is carried into the new term, once.
 */

let principal: Person, coordinator: Person, plus2Coordinator: Person, accountant: Person, student: Person;
const post = (path: string, body: unknown, who: Person) => call(path, { method: "POST", body, cookie: who.cookie });
const patch = (path: string, body: unknown, who: Person) => call(path, { method: "PATCH", body, cookie: who.cookie });
const get = (path: string, who: Person) => call(path, { cookie: who.cookie });
const idOf = async (r: Response) => ((await r.json()) as { id: string }).id;
async function ok<T = Record<string, unknown>>(r: Response, status = 200): Promise<T> {
  if (r.status !== status) throw new Error(`expected ${status}, got ${r.status}: ${await r.text()}`);
  return (await r.json()) as T;
}

/**
 * Fixed days inside the verified calendar (BS 2000 to 2084, D-014, D-112): the odd semester Shrawan to Poush 2082, so the next
 * one (Magh 2082 to Asar 2083) is verified too. A term past its days is still open until the Principal closes it.
 */
const termStart = bsToAd({ year: 2082, month: 4, day: 1 });
const termEnd = bsToAd({ year: 2082, month: 9, day: daysInMonth(2082, 9) });
/** The +2 year beside it runs a full twelve months, Shrawan 2082 to Asar 2083: a term takes only levels of its own length (D-114). */
const yearEnd = bsToAd({ year: 2083, month: 3, day: daysInMonth(2083, 3) });
const s: { sems: string[]; grade?: string; odd?: string; yearly?: string; classes: Record<string, string>; exam?: string; enrollments: Record<string, string>; next?: string; nextClasses: Record<string, string> } = {
  sems: [],
  classes: {},
  enrollments: {},
  nextClasses: {},
};

beforeAll(async () => {
  await seedSections();
  principal = await person("admin", "institution");
  coordinator = await person("coordinator", "institution");
  plus2Coordinator = await person("coordinator", "section", "plus2");
  accountant = await person("accountant", "institution");
  student = await person("student", "own");
});

describe("billing over a term of any length (D-110)", () => {
  it("a monthly item is charged for each BS month the term spans, from the month the student joined, due on its first day or the term's", () => {
    const start = bsToAd({ year: 2082, month: 10, day: 15 }); // Magh 15, mid-month
    const end = bsToAd({ year: 2083, month: 3, day: daysInMonth(2083, 3) }); // Asar's last day, across the BS new year
    expect(termMonths(start, end)).toEqual([[2082, 10], [2082, 11], [2082, 12], [2083, 1], [2083, 2], [2083, 3]]);
    const all = billingSchedule({ frequency: "monthly" }, { bsYear: 2082, startDate: start, endDate: end }, { enrolledOn: start, firstInProgramme: true });
    expect(all.map((c) => c.period)).toEqual(["2082-10", "2082-11", "2082-12", "2083-01", "2083-02", "2083-03"]);
    expect(all[0]!.dueOn).toBe(start); // the term's first day, not Magh 1 before it
    expect(all[1]!.dueOn).toBe(bsToAd({ year: 2082, month: 11, day: 1 }));
    const late = billingSchedule({ frequency: "monthly" }, { bsYear: 2082, startDate: start, endDate: end }, { enrolledOn: bsToAd({ year: 2083, month: 1, day: 10 }), firstInProgramme: true });
    expect(late.map((c) => c.period)).toEqual(["2083-01", "2083-02", "2083-03"]);
    // A quarter is three charges; once a term is one.
    expect(billingSchedule({ frequency: "monthly" }, { bsYear: 2082, startDate: bsToAd({ year: 2082, month: 4, day: 1 }), endDate: bsToAd({ year: 2082, month: 6, day: daysInMonth(2082, 6) }) }, { enrolledOn: "2000-01-01", firstInProgramme: true })).toHaveLength(3);
    expect(billingSchedule({ frequency: "yearly" }, { bsYear: 2082, startDate: start, endDate: end }, { enrolledOn: start, firstInProgramme: true })).toEqual([{ period: "year", dueOn: start }]);
  });
});

describe("a semester school beside a yearly one", () => {
  it("the Principal makes the ladder (with usual lengths) and two open terms at once; a level is in only one", async () => {
    const bca = await idOf(await post("/api/academics/programmes", { name: "BCA", sectionKey: "bachelors", affiliation: "TU" }, principal));
    for (let i = 1; i <= 4; i++) s.sems.push(await idOf(await post(`/api/academics/programmes/${bca}/levels`, { name: `Semester ${i}`, usualMonths: 6 }, principal)));
    const plus2 = await idOf(await post("/api/academics/programmes", { name: "Science", sectionKey: "plus2", affiliation: "NEB" }, principal));
    s.grade = await idOf(await post(`/api/academics/programmes/${plus2}/levels`, { name: "Grade 11", usualMonths: 12 }, principal));

    // The Co-ordinator does not make terms any more.
    expect((await post("/api/academics/years", { label: "Nope", startDate: termStart, endDate: termEnd }, coordinator)).status).toBe(403);
    s.odd = (await ok<{ id: string }>(await post("/api/academics/years", { label: "BCA odd", startDate: termStart, endDate: termEnd, levelIds: [s.sems[0], s.sems[2]] }, principal), 201)).id;
    s.yearly = (await ok<{ id: string }>(await post("/api/academics/years", { label: "+2 year", code: "P2YR", startDate: termStart, endDate: yearEnd, levelIds: [s.grade] }, principal), 201)).id;
    const clash = await post("/api/academics/years", { label: "Clash", startDate: termStart, endDate: termEnd, levelIds: [s.sems[0]] }, principal);
    expect(clash.status).toBe(422);
    for (const id of [s.odd, s.yearly]) await ok(await post(`/api/academics/years/${id}/activate`, undefined, principal));

    const { years } = await ok<{ years: { id: string; status: string; levels: { id: string }[] }[] }>(await get("/api/academics/years", coordinator));
    expect(years.filter((y) => y.status === "active").map((y) => y.id)).toEqual(expect.arrayContaining([s.odd, s.yearly]));
    expect(years.find((y) => y.id === s.odd)!.levels.map((l) => l.id)).toEqual([s.sems[0], s.sems[2]]);
  });

  it("the Co-ordinator makes classes only for the term's levels, an exam, and admits students", async () => {
    s.classes.sem1 = (await ok<{ id: string }>(await post("/api/academics/classes", { yearId: s.odd, levelId: s.sems[0], label: "A" }, coordinator), 201)).id;
    s.classes.sem3 = (await ok<{ id: string }>(await post("/api/academics/classes", { yearId: s.odd, levelId: s.sems[2], label: "A" }, coordinator), 201)).id;
    const outside = await post("/api/academics/classes", { yearId: s.odd, levelId: s.sems[1], label: "A" }, coordinator);
    expect(outside.status).toBe(422);
    expect(((await outside.json()) as { message: string }).message).toMatch(/Principal/);
    // The term's exam pattern (D-117): one exam, the whole of the final result.
    const made = await call(`/api/academics/years/${s.odd}/exam-pattern`, { method: "PUT", body: { graded: false, theoryMinPercent: 35, practicalMinPercent: 40, gradeBands: null, terminals: [{ name: "Final", weight: 100, hasPractical: false }] }, cookie: coordinator.cookie });
    expect(made.status).toBe(200);
    s.exam = ((await (await call(`/api/academics/years/${s.odd}/exam-pattern`, { cookie: coordinator.cookie })).json()) as { terminals: { id: string }[] }).terminals[0]!.id;

    let n = 0;
    for (const [name, cls] of [["Asha", s.classes.sem1], ["Bikash", s.classes.sem1], ["Chandra", s.classes.sem3]] as const) {
      const email = `${name.toLowerCase()}-${newPublicId().slice(0, 6)}@example.com`;
      const admitted = await ok<{ sid: string }>(
        await post("/api/admissions/walk-ins", { firstName: name, lastName: "Term", dob: "2005-03-14", phone: `98${String(77000000 + ++n)}`, email, guardianName: "Guardian", guardianPhone: "9800000011", levelId: cls === s.classes.sem1 ? s.sems[0] : s.sems[2], classId: cls }, coordinator),
        201,
      );
      const row = await db
        .prepare("SELECT en.public_id, ay.public_id AS term FROM enrollments en JOIN students st ON st.id = en.student_id JOIN academic_years ay ON ay.id = en.academic_year_id WHERE st.sid = ?1")
        .bind(admitted.sid)
        .first<{ public_id: string; term: string }>();
      expect(row!.term).toBe(s.odd); // enrolled in the term of the class chosen
      s.enrollments[name] = row!.public_id;
    }
  });

  it("the Accountant bills the term once; a receipt carries the term's code", async () => {
    const structure = (await ok<{ id: string }>(await post("/api/fees/structures", { levelId: s.sems[0] }, accountant), 201)).id;
    await ok(await post(`/api/fees/structures/${structure}/items`, { name: "Tuition", amountPaisa: 600_000, frequency: "yearly" }, accountant), 201);
    await ok(await post(`/api/fees/structures/${structure}/send`, {}, accountant), 201);
    const request = (await db.prepare("SELECT public_id FROM approval_requests WHERE subject_public_id = ?1").bind(structure).first<{ public_id: string }>())!.public_id;
    await ok(await post(`/api/approvals/${request}/approve`, undefined, principal));
    await ok(await post(`/api/fees/structures/${structure}/charges`, { classId: s.classes.sem1 }, accountant));
    // Once a term (D-110): one charge.
    expect(await count("SELECT COUNT(*) AS n FROM ledger_entries le JOIN enrollments en ON en.id = le.enrollment_id WHERE en.public_id = ?1 AND le.kind = 'charge'", s.enrollments.Asha!)).toBe(1);

    const paid = await ok<{ receipt: { number: string } }>(await post("/api/fees/payments/cash", { enrollmentId: s.enrollments.Asha, amountPaisa: 150_000, idempotencyKey: newPublicId() }, accountant), 201);
    const code = (await db.prepare("SELECT code FROM academic_years WHERE public_id = ?1").bind(s.odd).first<{ code: string }>())!.code;
    expect(paid.receipt.number).toMatch(new RegExp(`^[A-Za-z0-9]+-${code}-00001$`));
    // Bikash owes nothing yet: his charge was made too, so pay it all.
    const owed = (await db.prepare("SELECT SUM(le.amount_paisa) AS n FROM ledger_entries le JOIN enrollments en ON en.id = le.enrollment_id WHERE en.public_id = ?1").bind(s.enrollments.Bikash).first<{ n: number }>())!.n;
    await ok(await post("/api/fees/payments/cash", { enrollmentId: s.enrollments.Bikash, amountPaisa: owed, idempotencyKey: newPublicId() }, accountant), 201);
  });

  it("the Principal cannot close the term until every class's results are published; then it closes and refuses writes", async () => {
    const refused = await post(`/api/academics/years/${s.odd}/close`, undefined, principal);
    expect(refused.status).toBe(409);
    const body = (await refused.json()) as { error: string; check: { missing: { classId: string }[] } };
    expect(body.error).toBe("not_ready");
    expect(body.check.missing.map((m) => m.classId).sort()).toEqual([s.classes.sem1, s.classes.sem3].sort());
    expect((await post(`/api/academics/years/${s.odd}/close`, undefined, coordinator)).status).toBe(403);

    // Results publish through their own module (tested there); here the publication rows stand for them.
    for (const cls of [s.classes.sem1!, s.classes.sem3!]) {
      await db
        .prepare(
          `INSERT INTO result_publications (public_id, class_id, terminal_id, pattern, published_by_user_id, published_at)
           SELECT ?1, c.id, t.id, '{}', u.id, '2026-10-01T00:00:00Z' FROM classes c, terminals t, users u WHERE c.public_id = ?2 AND t.public_id = ?3 AND u.public_id = ?4`,
        )
        .bind(newPublicId(), cls, s.exam, coordinator.publicId)
        .run();
    }
    await ok(await post(`/api/academics/years/${s.odd}/close`, undefined, principal));
    expect((await post("/api/fees/payments/cash", { enrollmentId: s.enrollments.Asha, amountPaisa: 1_000, idempotencyKey: newPublicId() }, accountant)).status).toBe(409);
    expect((await post("/api/academics/classes", { yearId: s.odd, levelId: s.sems[0], label: "B" }, coordinator)).status).toBe(409);
    // The yearly term next to it is untouched.
    expect((await db.prepare("SELECT status FROM academic_years WHERE public_id = ?1").bind(s.yearly).first<{ status: string }>())!.status).toBe("active");
  });

  it("the next term is filled in (Semesters 2 and 4, six months on); the Principal confirms it", async () => {
    const next = await ok<{ label: string; startDate: string; endDate: string; levels: { id: string }[] }>(await get(`/api/academics/years/${s.odd}/next`, principal));
    expect(next.levels.map((l) => l.id)).toEqual([s.sems[1], s.sems[3]]);
    expect(next.startDate > termEnd).toBe(true);
    s.next = (await ok<{ id: string }>(await post("/api/academics/years", { label: next.label, startDate: next.startDate, endDate: next.endDate, levelIds: next.levels.map((l) => l.id) }, principal), 201)).id;
    await ok(await post(`/api/academics/years/${s.next}/activate`, undefined, principal));
    s.nextClasses.sem2 = (await ok<{ id: string }>(await post("/api/academics/classes", { yearId: s.next, levelId: s.sems[1], label: "A" }, coordinator), 201)).id;
    s.nextClasses.sem4 = (await ok<{ id: string }>(await post("/api/academics/classes", { yearId: s.next, levelId: s.sems[3], label: "A" }, coordinator), 201)).id;
  });

  it("the Co-ordinator moves each student on: promote carries what is owed, once; leaving needs nothing owed", async () => {
    const board = await ok<{ termId: string; classes: { classId: string; nextLevelId: string | null; students: { enrollmentId: string; outcome: string; balancePaisa: number }[] }[]; targets: { classId: string }[] }>(
      await get("/api/promotions", coordinator),
    );
    expect(board.termId).toBe(s.odd);
    const asha = board.classes.flatMap((c) => c.students).find((st) => st.enrollmentId === s.enrollments.Asha)!;
    expect(asha.outcome).toBe("pending");
    expect(asha.balancePaisa).toBe(450_000); // 6,000 for the term, less 1,500 paid
    expect(board.targets.map((t) => t.classId)).toEqual(expect.arrayContaining([s.nextClasses.sem2, s.nextClasses.sem4]));

    const { results } = await ok<{ results: { enrollmentId: string; ok: boolean; reason?: string; newEnrollmentId?: string; carriedDues?: boolean }[] }>(
      await post(
        "/api/promotions",
        {
          moves: [
            { enrollmentId: s.enrollments.Asha, action: "promote", classId: s.nextClasses.sem2 },
            { enrollmentId: s.enrollments.Bikash, action: "promote", classId: s.nextClasses.sem4 }, // two levels up: refused
            { enrollmentId: s.enrollments.Chandra, action: "graduate" }, // not the last level: refused
          ],
        },
        coordinator,
      ),
    );
    expect(results[0]).toMatchObject({ ok: true, carriedDues: true });
    expect(results[1]).toMatchObject({ ok: false, reason: "invalid" });
    expect(results[2]).toMatchObject({ ok: false, reason: "invalid" });

    // What Asha owed is in her new term's account, once; a second click changes nothing.
    const newAsha = results[0]!.newEnrollmentId!;
    const carried = () => count("SELECT COUNT(*) AS n FROM ledger_entries le JOIN enrollments en ON en.id = le.enrollment_id WHERE en.public_id = ?1 AND le.kind = 'carried_dues' AND le.amount_paisa = 450000", newAsha);
    expect(await carried()).toBe(1);
    const again = await ok<{ results: { ok: boolean; reason?: string }[] }>(await post("/api/promotions", { moves: [{ enrollmentId: s.enrollments.Asha, action: "promote", classId: s.nextClasses.sem2 }] }, coordinator));
    expect(again.results[0]).toEqual({ enrollmentId: s.enrollments.Asha, ok: false, reason: "already_moved" });
    expect(await carried()).toBe(1);

    // Bikash paid everything, so he may leave; Chandra is promoted to Semester 4 with nothing owed.
    const second = await ok<{ results: { ok: boolean; carriedDues?: boolean }[] }>(
      await post(
        "/api/promotions",
        { moves: [{ enrollmentId: s.enrollments.Bikash, action: "leave" }, { enrollmentId: s.enrollments.Chandra, action: "promote", classId: s.nextClasses.sem4 }] },
        coordinator,
      ),
    );
    expect(second.results).toMatchObject([{ ok: true }, { ok: true, carriedDues: false }]);
    expect((await db.prepare("SELECT st.status FROM students st JOIN enrollments en ON en.student_id = st.id WHERE en.public_id = ?1").bind(s.enrollments.Bikash).first<{ status: string }>())!.status).toBe("left");

    const after = await ok<{ classes: { students: { enrollmentId: string; outcome: string; movedTo: string | null }[] }[] }>(await get(`/api/promotions?term=${s.odd}`, coordinator));
    const outcomes = Object.fromEntries(after.classes.flatMap((c) => c.students).map((st) => [st.enrollmentId, st.outcome]));
    expect(outcomes).toEqual({ [s.enrollments.Asha!]: "promoted", [s.enrollments.Bikash!]: "left", [s.enrollments.Chandra!]: "promoted" });
  });

  it("leaving with dues is refused; another section's Co-ordinator and a student get nothing", async () => {
    // A fresh student in the new term owes nothing there yet, but Asha's carried dues stop her leaving after the next close.
    expect((await get("/api/promotions", student)).status).toBe(403);
    const theirs = await ok<{ classes: unknown[] }>(await get(`/api/promotions?term=${s.odd}`, plus2Coordinator));
    expect(theirs.classes).toEqual([]);
    const refused = await ok<{ results: { ok: boolean; reason?: string }[] }>(await post("/api/promotions", { moves: [{ enrollmentId: s.enrollments.Chandra, action: "leave" }] }, plus2Coordinator));
    expect(refused.results[0]).toMatchObject({ ok: false, reason: "not_found" });
    expect((await post("/api/promotions", { moves: [{ enrollmentId: s.enrollments.Asha, action: "promote" }] }, coordinator)).status).toBe(400); // promote needs a class
  });

  it("both chains are whole", async () => {
    expect((await verifyLedgerChain(db, auditKey)).ok).toBe(true);
    expect(await verifyAuditChain(db, auditKey)).toMatchObject({ ok: true });
  });

  it("a level's usual length can be changed by the Principal and is read back", async () => {
    await ok(await patch(`/api/academics/levels/${s.sems[0]}`, { usualMonths: 5 }, principal));
    const { programmes } = await ok<{ programmes: { levels: { id: string; usualMonths: number | null }[] }[] }>(await get("/api/academics/programmes", principal));
    expect(programmes.flatMap((p) => p.levels).find((l) => l.id === s.sems[0])!.usualMonths).toBe(5);
  });
});
