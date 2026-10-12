import { beforeAll, describe, expect, it } from "vitest";

import { call, db, person, seedSections, type Person } from "./academics-helpers";
import { addSubject, examTerm, pattern, resultsClass, runTerminal } from "./results-helpers";
import type { ClassFixture } from "./schoolday-helpers";

/**
 * Pass marks per subject, end to end (the PM, 2026-10-11, the first school): the Co-ordinator sets each subject's pass
 * marks on the curriculum; a school that has the switch on gets Pass or Fail on every terminal and on the final from
 * those marks; a school without it is exactly as before. One terminal of 100 so the final comes out with it.
 */

let coordinator: Person;

const setSwitch = (on: boolean) =>
  db.prepare("INSERT INTO school (id, name, short_name, pass_marks_per_subject) VALUES (1, 'Test school', 'Test', ?1) ON CONFLICT (id) DO UPDATE SET pass_marks_per_subject = excluded.pass_marks_per_subject").bind(on ? 1 : 0).run();
const patch = (offeringId: string, body: unknown) => call(`/api/academics/offerings/${offeringId}`, { method: "PATCH", body, cookie: coordinator.cookie });

interface Card {
  kind: "terminal" | "final";
  card: { body: { passed?: boolean | null; outcome: string; subjects: { name: string; passed?: boolean | null }[] } };
}
const cardsOf = async (fixture: ClassFixture, pupil: number) => ((await (await call("/api/results/me", { cookie: fixture.pupils[pupil]!.person.cookie })).json()) as { results: Card[] }).results;

beforeAll(async () => {
  await seedSections();
  coordinator = await person("coordinator", "institution");
});

describe("setting a subject's pass marks", () => {
  it("is saved on the subject, read back, and must fit inside the paper", async () => {
    const term = await examTerm(pattern(false));
    const fixture = await resultsClass("plus2", 1, term);
    const science = await addSubject(fixture, { full: 100, practical: 25 });
    expect((await patch(science.offeringId, { passTheoryHundredths: 2400, passPracticalHundredths: 800 })).status).toBe(200);
    expect(await db.prepare("SELECT pass_theory_hundredths AS t, pass_practical_hundredths AS p FROM subject_offerings WHERE public_id = ?1").bind(science.offeringId).first()).toEqual({ t: 2400, p: 800 });
    // Theory is 75 marks: 76 does not fit. The practical is 25: 26 does not fit.
    expect((await patch(science.offeringId, { passTheoryHundredths: 7600 })).status).toBe(422);
    expect((await patch(science.offeringId, { passPracticalHundredths: 2600 })).status).toBe(422);
    // A subject without a practical has no practical pass mark; taking the practical away takes its pass mark away.
    const plain = await addSubject(fixture, { full: 100 });
    expect((await patch(plain.offeringId, { passPracticalHundredths: 500 })).status).toBe(422);
    expect((await patch(science.offeringId, { practicalHundredths: null })).status).toBe(200);
    expect(await db.prepare("SELECT pass_practical_hundredths AS p FROM subject_offerings WHERE public_id = ?1").bind(science.offeringId).first()).toEqual({ p: null });
  });

  it("only a Co-ordinator can set them: a teacher cannot", async () => {
    const term = await examTerm(pattern(false));
    const fixture = await resultsClass("plus2", 1, term);
    const maths = await addSubject(fixture);
    expect((await call(`/api/academics/offerings/${maths.offeringId}`, { method: "PATCH", body: { passTheoryHundredths: 3200 }, cookie: maths.teacher.cookie })).status).toBe(403);
  });
});

describe("a school with pass marks per subject", () => {
  it("passes and fails each subject on its own marks, on the terminal and on the final", async () => {
    await setSwitch(true);
    const term = await examTerm(pattern(false, [{ name: "Final", weight: 100, hasPractical: false }]));
    const fixture = await resultsClass("plus2", 3, term);
    const maths = await addSubject(fixture, { full: 100 });
    const art = await addSubject(fixture, { full: 50 });
    expect((await patch(maths.offeringId, { passTheoryHundredths: 3200 })).status).toBe(200);
    expect((await patch(art.offeringId, { passTheoryHundredths: 2000 })).status).toBe(200);
    // Pupil 0: 90% both. Pupil 1: Maths 33 (pass 32), Art 19 of 50 (pass 20). Pupil 2: Maths 31 (fails), Art 20 (passes).
    const percents: Record<number, [number, number]> = { 0: [90, 90], 1: [33, 38], 2: [31, 40] };
    const published = await runTerminal(fixture, [maths, art], term.terminals[0]!, (p, _part, subject) => percents[p]![subject]!, coordinator);
    expect(published.status).toBe(201);

    for (const [pupil, expected] of [
      [0, true],
      [1, false],
      [2, false],
    ] as const) {
      const cards = await cardsOf(fixture, pupil);
      const terminal = cards.find((c) => c.kind === "terminal")!.card.body;
      const final = cards.find((c) => c.kind === "final")!.card.body;
      expect(terminal.passed, `terminal ${pupil}`).toBe(expected);
      expect(final.passed, `final ${pupil}`).toBe(expected);
      expect(final.outcome).toBe(expected ? "Pass" : "Fail");
    }
    // The class sheet flags the failing subject cells (the screen turns their digits red).
    const sheet = (await (await call(`/api/results/classes/${fixture.classId}/final/sheet`, { cookie: coordinator.cookie })).json()) as { subjects: { offeringId: string }[]; students: { subjects: ({ passed: boolean | null } | null)[] }[] };
    const flags = sheet.students.map((st) => st.subjects.map((x) => x?.passed).join(","));
    expect(flags.filter((f) => f === "true,true")).toHaveLength(1); // pupil 0 only
    expect(flags.filter((f) => f.includes("false"))).toHaveLength(2);
    // The CSV cannot be coloured: it names the subjects below their pass marks in a column of its own.
    const csv = await (await call(`/api/results/classes/${fixture.classId}/final/sheet.csv`, { cookie: coordinator.cookie })).text();
    expect(csv.split("\r\n")[0]).toContain('"Below pass marks"');
    expect(csv).toContain(art.name); // pupil 1 is below Art's pass marks
    expect(csv).toContain(`"${maths.name}"`);
    const second = (await cardsOf(fixture, 1)).find((c) => c.kind === "final")!.card.body.subjects;
    expect(second.map((s) => s.passed)).toEqual(expect.arrayContaining([true, false]));
    const third = (await cardsOf(fixture, 2)).find((c) => c.kind === "terminal")!.card.body.subjects;
    expect(third.find((s) => s.name === maths.name)!.passed).toBe(false);
    expect(third.find((s) => s.name === art.name)!.passed).toBe(true);
  });

  it("a later change to a subject's pass marks never moves a result already published", async () => {
    await setSwitch(true);
    const term = await examTerm(pattern(false, [{ name: "Final", weight: 100, hasPractical: false }]));
    const fixture = await resultsClass("plus2", 1, term);
    const maths = await addSubject(fixture);
    await patch(maths.offeringId, { passTheoryHundredths: 3200 });
    await runTerminal(fixture, [maths], term.terminals[0]!, () => 33, coordinator);
    await patch(maths.offeringId, { passTheoryHundredths: 9000 });
    expect((await cardsOf(fixture, 0)).find((c) => c.kind === "final")!.card.body.passed).toBe(true);
  });
});

describe("a school without it", () => {
  it("is as before: a terminal passes no one, and the pattern's percentages decide the final", async () => {
    await setSwitch(false);
    const term = await examTerm(pattern(false, [{ name: "Final", weight: 100, hasPractical: false }]));
    const fixture = await resultsClass("plus2", 2, term);
    const maths = await addSubject(fixture);
    await patch(maths.offeringId, { passTheoryHundredths: 9000 }); // set but not used
    await runTerminal(fixture, [maths], term.terminals[0]!, (p) => (p === 0 ? 36 : 34), coordinator);
    const cards = await cardsOf(fixture, 0);
    expect(cards.find((c) => c.kind === "terminal")!.card.body.passed ?? null).toBeNull();
    expect(cards.find((c) => c.kind === "final")!.card.body.passed).toBe(true); // 36% is over the pattern's 35%
    expect((await cardsOf(fixture, 1)).find((c) => c.kind === "final")!.card.body.passed).toBe(false); // 34% is under it
  });
});
