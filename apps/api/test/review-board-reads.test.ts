import { beforeAll, describe, expect, it } from "vitest";

import { reviewBoard } from "../src/modules/results/sheets";
import { call, db, person, seedSections, type Person } from "./academics-helpers";
import { addSubject, enterAndSubmit, examTerm, pattern, resultsClass, sheetIdOf, type Subject, type Term } from "./results-helpers";
import { enrol, type ClassFixture } from "./schoolday-helpers";

/**
 * The Co-ordinator's review board (D-192). On 2026-11-20 a live school's database went over the free plan's 5,000,000 rows read
 * in a day: the board read about 150,000 rows per load, because it asked "is the class ready to publish?" once for
 * every subject row, and each asking rescanned every subject and every mark of the class. The board now works that out
 * once per class from the rows it already has. These tests hold the rule (it must agree with what publishing allows)
 * and a budget of rows read per load.
 */

let coordinator: Person;
let term: Term;
let first: string;

interface Board {
  classes: { classId: string; ready: boolean; subjects: { offeringId: string; status: string; missing: number }[] }[];
}

const post = (path: string, body: unknown) => call(path, { method: "POST", body, cookie: coordinator.cookie });
const boardOf = async (classId: string) => ((await (await call(`/api/results/review?terminalId=${first}`, { cookie: coordinator.cookie })).json()) as Board).classes.find((c) => c.classId === classId);
const verify = async (fixture: ClassFixture, subjects: Subject[]) =>
  post("/api/results/review/verify", { sheetIds: await Promise.all(subjects.map((s) => sheetIdOf(fixture, s, first))) });

/** A database that adds up the rows each query reads, as D1 reports them. */
function counting(real: D1Database): { db: D1Database; rowsRead: () => number } {
  let rows = 0;
  const unwrap = new WeakMap<object, D1PreparedStatement>();
  const add = (meta: { rows_read?: number } | undefined) => void (rows += meta?.rows_read ?? 0);
  const wrap = (s: D1PreparedStatement): D1PreparedStatement => {
    const w = {
      bind: (...values: unknown[]) => wrap(s.bind(...values)),
      all: async () => {
        const r = await s.all();
        add(r.meta);
        return r;
      },
      run: async () => {
        const r = await s.run();
        add(r.meta);
        return r;
      },
    };
    unwrap.set(w, s);
    return w as unknown as D1PreparedStatement;
  };
  const db = {
    prepare: (sql: string) => wrap(real.prepare(sql)),
    batch: async (statements: D1PreparedStatement[]) => {
      const results = await real.batch(statements.map((s) => unwrap.get(s as object)!));
      for (const r of results) add(r.meta);
      return results;
    },
  };
  return { db: db as unknown as D1Database, rowsRead: () => rows };
}

beforeAll(async () => {
  await seedSections();
  coordinator = await person("coordinator", "institution");
  term = await examTerm(pattern(false));
  first = term.terminals[0]!;
});

describe("the review board's ready flag", () => {
  it("is set only when every subject is verified and no mark is missing, and publishing agrees", async () => {
    const fixture = await resultsClass("plus2", 3, term);
    const a = await addSubject(fixture);
    const b = await addSubject(fixture);
    await enterAndSubmit(fixture, a, first, 70);
    await enterAndSubmit(fixture, b, first, 60);

    await verify(fixture, [a]);
    expect((await boardOf(fixture.classId))!.ready).toBe(false);

    await verify(fixture, [b]);
    expect((await boardOf(fixture.classId))!.ready).toBe(true);

    // A student who joins after the sheets were verified has no marks: the class is no longer ready, and publishing refuses.
    await enrol(fixture.classId, "Latecomer");
    const late = (await boardOf(fixture.classId))!;
    expect(late.ready).toBe(false);
    expect(late.subjects.map((s) => s.missing)).toEqual([1, 1]);
    const refused = await post(`/api/results/classes/${fixture.classId}/publish`, { terminalId: first });
    expect(refused.status).toBe(409);
  });

  it("a ready class publishes, and is then shown as not ready (it is done)", async () => {
    const fixture = await resultsClass("plus2", 2, term);
    const a = await addSubject(fixture);
    await enterAndSubmit(fixture, a, first, 80);
    await verify(fixture, [a]);
    expect((await boardOf(fixture.classId))!.ready).toBe(true);
    expect((await post(`/api/results/classes/${fixture.classId}/publish`, { terminalId: first })).status).toBe(201);
    expect((await boardOf(fixture.classId))!.ready).toBe(false);
  });

  it("a class with no subject anyone takes is not on the board", async () => {
    const fixture = await resultsClass("plus2", 2, term);
    expect(await boardOf(fixture.classId)).toBeUndefined();
  });
});

describe("the review board's reads", () => {
  it("a class of 25 with 5 verified subjects stays within a small budget of rows read per load", async () => {
    const fixture = await resultsClass("bachelors", 25, term);
    const subjects: Subject[] = [];
    for (let i = 0; i < 5; i++) subjects.push(await addSubject(fixture, i % 2 === 0 ? { practical: 25 } : {}));
    for (const s of subjects) await enterAndSubmit(fixture, s, first, 65);
    await verify(fixture, subjects);

    const meter = counting(db);
    const board = await reviewBoard(meter.db, { institution: 1, sections: null }, first);
    expect(board.classes.find((c) => c.classId === fixture.classId)!.ready).toBe(true);
    // Before D-192 this load read 3,347 rows (the ready check ran once per subject row); now 648. The old cost grew with
    // the square of the subjects in a class, which is how one load of a live school's board read about 150,000.
    expect(meter.rowsRead()).toBeLessThan(1200);
  }, 180_000);
});
