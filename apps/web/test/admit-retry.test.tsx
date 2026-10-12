import { describe, expect, it } from "vitest";

import { admitRows, type AdmitDeps, type Recovery } from "@/sheets/admit-rows";
import { parseStudentSheet } from "@/sheets/student-import";

// The class import keeps going until every student is in (the PM, 2026-10-12): a busy server (a 503, a timeout) is waited out
// and the row tried again, and what a failed try left behind (a waiting application, or a student whose answer was lost) is
// found and finished instead of being admitted twice.

const rowsOf = (names: [string, string][]) => {
  const parsed = parseStudentSheet([["First name", "Last name"], ...names], "level-1");
  if (!parsed.ok) throw new Error("sheet");
  return parsed.rows;
};

type WalkIn = AdmitDeps["walkIn"];
const admitted = (n: number) => ({ ok: true as const, sid: `2083-${String(n).padStart(5, "0")}`, temporaryPassword: "4821" });
const busy = { ok: false as const, reason: "failed" as const };

function setup(script: WalkIn[], recovery?: Partial<Recovery>) {
  const waits: number[] = [];
  const calls: string[] = [];
  let at = 0;
  const deps: AdmitDeps = {
    toAd: async () => ({ ok: true, ad: "2008-05-14" }),
    suggestEmail: async (first, last) => `${first}.${last}@student.com`.toLowerCase(),
    walkIn: async (...args) => {
      calls.push(`walkIn ${args[0].firstName}`);
      return script[Math.min(at++, script.length - 1)]!(...args);
    },
    wait: async (ms) => void waits.push(ms),
    recovery: {
      pendingApplications: async () => [],
      approve: async () => ({ ok: false, reason: "failed" }),
      studentsNamed: async () => [],
      newPassword: async () => null,
      ...recovery,
    },
  };
  return { deps, waits, calls };
}
const reply = (r: Awaited<ReturnType<WalkIn>>): WalkIn => async () => r;

describe("admitting a class list when the server is busy", () => {
  it("waits and tries the same student again after a busy answer, then goes on", async () => {
    const { deps, waits, calls } = setup([reply(busy), reply(busy), reply(admitted(1)), reply(admitted(2))]);
    const results = await admitRows(deps, rowsOf([["Sita", "Rai"], ["Hari", "Rai"]]));
    expect(results.map((r) => r.status)).toEqual(["admitted", "admitted"]);
    expect(calls).toEqual(["walkIn Sita", "walkIn Sita", "walkIn Sita", "walkIn Hari"]);
    expect(waits).toEqual([2000, 4000]); // the wait grows
  });

  it("tells the screen it is waiting, with which try it is", async () => {
    const { deps } = setup([reply(busy), reply(admitted(1))]);
    const seen: { line: number; attempt: number; of: number }[] = [];
    await admitRows(deps, rowsOf([["Sita", "Rai"]]), { onWait: (w) => seen.push(w) });
    expect(seen).toEqual([{ line: 2, attempt: 1, of: 8 }]);
  });

  it("finishes the waiting application a failed try left, instead of saving the student again", async () => {
    const approved: string[] = [];
    const { deps, calls } = setup([reply(busy)], {
      pendingApplications: async () => ["app-1"],
      approve: async (id) => (approved.push(id), { ok: true, sid: "2083-00007", temporaryPassword: "1234" }),
    });
    const results = await admitRows(deps, rowsOf([["Sita", "Rai"]]));
    expect(results).toEqual([{ line: 2, name: "Sita Rai", status: "admitted", sid: "2083-00007", email: "sita.rai@student.com", password: "1234" }]);
    expect(approved).toEqual(["app-1"]);
    expect(calls).toEqual(["walkIn Sita"]); // sent once, never again
  });

  it("tries the approval again when it is busy too, and gives up on it only after a few tries", async () => {
    let tries = 0;
    const { deps, waits } = setup([reply(busy), reply(admitted(9))], {
      pendingApplications: async () => ["app-1"],
      approve: async () => (++tries < 3 ? { ok: false, reason: "failed" } : { ok: true, sid: "2083-00003", temporaryPassword: "5555" }),
    });
    const [result] = await admitRows(deps, rowsOf([["Sita", "Rai"]]));
    expect(result).toMatchObject({ status: "admitted", sid: "2083-00003", password: "5555" });
    expect(tries).toBe(3);
    expect(waits.length).toBeGreaterThanOrEqual(2);
  });

  it("when the application was already approved but the answer was lost, gives the student a new password and does not save again", async () => {
    const { deps, calls } = setup([reply(busy)], {
      pendingApplications: async () => ["app-1"],
      approve: async () => ({ ok: false, reason: "conflict" }),
      studentsNamed: async () => [{ id: "stu-1", sid: "2083-00012" }],
      newPassword: async () => "9876",
    });
    const [result] = await admitRows(deps, rowsOf([["Sita", "Rai"]]));
    expect(result).toMatchObject({ status: "admitted", sid: "2083-00012", password: "9876" });
    expect(calls).toEqual(["walkIn Sita"]);
  });

  it("finds a student admitted by the failed try (its answer was lost) but never one who was in the class before", async () => {
    const { deps } = setup([reply(busy)], {
      studentsNamed: async () => [{ id: "old", sid: "2083-00001" }, { id: "new", sid: "2083-00005" }],
      newPassword: async (id) => (id === "new" ? "4444" : "0000"),
    });
    const [result] = await admitRows(deps, rowsOf([["Sita", "Rai"]]), { known: new Set(["2083-00001"]) });
    expect(result).toMatchObject({ status: "admitted", sid: "2083-00005", password: "4444" });
  });

  it("does not hand the same lost student to two rows with the same name", async () => {
    const found = [{ id: "a", sid: "2083-00005" }];
    const { deps } = setup([reply(busy), reply(busy), reply(admitted(6))], {
      studentsNamed: async () => found,
      newPassword: async () => "4444",
    });
    const results = await admitRows(deps, rowsOf([["Ankush", "Rai"], ["Ankush", "Rai"]]));
    expect(results.map((r) => (r.status === "admitted" ? r.sid : r.status))).toEqual(["2083-00005", "2083-00006"]);
  });

  it("does not send a student again while it cannot tell what the last try left: it waits and looks again", async () => {
    let looks = 0;
    const { deps, calls, waits } = setup([reply(busy), reply(admitted(1))], {
      pendingApplications: async () => (++looks < 3 ? null : []), // the queue cannot be read twice, then it can: nothing is waiting
      studentsNamed: async () => [],
    });
    const [result] = await admitRows(deps, rowsOf([["Sita", "Rai"]]));
    expect(result).toMatchObject({ status: "admitted" });
    expect(looks).toBe(3);
    expect(calls).toEqual(["walkIn Sita", "walkIn Sita"]); // sent again only once the lookup said nothing was left
    expect(waits).toEqual([2000, 4000, 8000]);
  });

  it("finishes the waiting application once the lookup works again, rather than saving the student twice", async () => {
    let looks = 0;
    const approved: string[] = [];
    const { deps, calls } = setup([reply(busy)], {
      pendingApplications: async () => (++looks < 2 ? null : ["app-1"]),
      approve: async (id) => (approved.push(id), { ok: true, sid: "2083-00009", temporaryPassword: "1111" }),
    });
    const [result] = await admitRows(deps, rowsOf([["Sita", "Rai"]]));
    expect(result).toMatchObject({ status: "admitted", sid: "2083-00009" });
    expect(approved).toEqual(["app-1"]);
    expect(calls).toEqual(["walkIn Sita"]);
  });

  it("says the student may not be in, and sends nothing more, when the lookup never works", async () => {
    const { deps, calls } = setup([reply(busy)], { pendingApplications: async () => null });
    const [result] = await admitRows(deps, rowsOf([["Sita", "Rai"]]));
    expect(result).toMatchObject({ status: "problem" });
    expect(calls).toEqual(["walkIn Sita"]);
  });

  it("gives up on a student after the last try, says so, and goes on with the rest", async () => {
    const { deps, waits } = setup([reply(busy), reply(busy), reply(busy), reply(busy), reply(busy), reply(busy), reply(busy), reply(busy), reply(busy), reply(admitted(1))]);
    const results = await admitRows(deps, rowsOf([["Sita", "Rai"], ["Hari", "Rai"]]));
    expect(results.map((r) => r.status)).toEqual(["problem", "admitted"]);
    expect(waits).toEqual([2000, 4000, 8000, 15000, 30000, 30000, 30000, 30000]);
  });

  it("does not wait for an answer that will not change: a duplicate, a bad detail, no permission", async () => {
    const { deps, waits } = setup([reply({ ok: false, reason: "duplicate", matches: [{ name: "X", sid: "1" }] }), reply({ ok: false, reason: "invalid", message: "No" }), reply({ ok: false, reason: "forbidden" })]);
    const results = await admitRows(deps, rowsOf([["A", "B"], ["C", "D"], ["E", "F"]]));
    expect(results.map((r) => r.status)).toEqual(["duplicate", "problem", "problem"]);
    expect(waits).toEqual([]);
  });

  it("pauses a moment after each student, to be gentle with the server", async () => {
    const { deps, waits } = setup([reply(admitted(1)), reply(admitted(2))]);
    await admitRows(deps, rowsOf([["A", "B"], ["C", "D"]]), { pauseMs: 600 });
    expect(waits).toEqual([600, 600]);
  });

  it("stretches the pause between students after a busy answer, and eases back after five clean ones", async () => {
    // one busy answer on the 2nd student, then seven that go straight in
    const { deps, waits } = setup([reply(admitted(1)), reply(busy), reply(admitted(2)), ...Array.from({ length: 6 }, (_, i) => reply(admitted(3 + i)))]);
    await admitRows(deps, rowsOf(Array.from({ length: 8 }, (_, i) => [`S${i}`, "Rai"] as [string, string])), { pauseMs: 1000 });
    const pauses = waits.filter((w) => w === 1000 || w === 2500); // the base pause, and the base plus the 1.5 s stretch
    expect(pauses).toEqual([1000, 1000 + 1500 /* the 2nd, which was busy */, 1000 + 1500, 1000 + 1500, 1000 + 1500, 1000 + 1500, 1000, 1000]);
  });

  it("after a reload, looks for the student the stopped import was on before sending anyone", async () => {
    const { deps, calls } = setup([reply(admitted(9))], {
      pendingApplications: async () => [],
      studentsNamed: async () => [{ id: "stu-1", sid: "2083-00040" }],
      newPassword: async () => "7777",
    });
    const results = await admitRows(deps, rowsOf([["Sita", "Rai"], ["Hari", "Rai"]]), { checkFirst: true });
    // Sita was already in: she gets a new password and is not sent; Hari, the next, is sent as usual.
    expect(results[0]).toMatchObject({ status: "admitted", sid: "2083-00040", password: "7777" });
    expect(results[1]).toMatchObject({ status: "admitted" });
    expect(calls).toEqual(["walkIn Hari"]);
  });

  it("after a reload, sends the first student only when nothing of them is found", async () => {
    const { deps, calls } = setup([reply(admitted(1))], { pendingApplications: async () => [], studentsNamed: async () => [] });
    const [result] = await admitRows(deps, rowsOf([["Sita", "Rai"]]), { checkFirst: true });
    expect(result).toMatchObject({ status: "admitted" });
    expect(calls).toEqual(["walkIn Sita"]);
  });

  it("hands each result over as it comes, so the sign-in sheet can be saved before the end", async () => {
    const { deps } = setup([reply(admitted(1)), reply(admitted(2))]);
    const seen: string[] = [];
    await admitRows(deps, rowsOf([["A", "B"], ["C", "D"]]), { onResult: (r) => seen.push(r.name) });
    expect(seen).toEqual(["A B", "C D"]);
  });
});
