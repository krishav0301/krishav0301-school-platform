import { describe, expect, it } from "vitest";

import { parsePack } from "../src/core/config";
import royalJson from "../../../packs/royal-softech/pack.json";
import lahanJson from "../../../packs/lahan-manakamana/pack.json";

/**
 * The first real school (the PM, 2026-10-11): Lahan Manakamana Secondary English Boarding School runs only the result system.
 * Its file turns off what it does not use and the Admin's second step, and carries nothing of another school.
 */
describe("the Lahan Manakamana school file", () => {
  const pack = parsePack(lahanJson);

  it("is the school, with the Principal's word and no section made for it (the Principal makes them)", () => {
    expect(pack.school.name).toBe("Lahan Manakamana Secondary English Boarding School");
    expect(pack.sections).toEqual([]);
    expect(pack.terminology).toEqual({ "role.admin": "Principal" });
  });

  it("turns off fees, attendance, teacher attendance, homework, notes, the daily log, Top 20 and electives, and leaves results to the core", () => {
    for (const key of ["fees", "attendance", "teacher_attendance", "homework", "notes", "top20", "activity_log", "electives"]) expect(pack.modules[key], key).toBe(false);
    expect(Object.keys(pack.modules).sort()).toEqual(["activity_log", "attendance", "electives", "fees", "homework", "notes", "teacher_attendance", "top20"]);
  });

  it("lets the Principal sign in with an ID and a password only", () => {
    expect(pack.school.adminTwoFactor).toBe(false);
  });

  it("lets a student keep the 4-digit password given at admission and sign in with their email and it (D-145)", () => {
    expect(pack.school.studentKeepsPin).toBe(true);
    expect(parsePack(royalJson).school.studentKeepsPin).toBe(false); // every other school is as it was
  });

  it("says nothing of Royal Softech anywhere (D-008: one school's name or data never appears in another's)", () => {
    expect(JSON.stringify(lahanJson)).not.toMatch(/royal|softech/i);
  });
});
