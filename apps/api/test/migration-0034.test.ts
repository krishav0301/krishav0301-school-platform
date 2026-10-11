import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { registerWalkIn } from "../src/modules/admissions/service";
import { auditKey, db, person, seedSections, type Person } from "./academics-helpers";
import { classWith } from "./schoolday-helpers";

/**
 * Migration 0034 (the PM, 2026-10-10): a student can be entered with just a name. `students` and `applications` are
 * rebuilt with the details optional. The test database already ran it; it is run again here over real rows, as it would
 * run on a school's data, to show every row keeps its id and values and the links to them (enrolments, the application's
 * student) still hold.
 */
let coordinator: Person;
beforeAll(async () => {
  await seedSections();
  coordinator = await person("coordinator", "institution");
});

function migrationQueries(): string[] {
  const migration = (env.TEST_MIGRATIONS as { name: string; queries: string[] }[]).find((m) => m.name.startsWith("0034_"));
  if (!migration) throw new Error("migration 0034 not found");
  return migration.queries;
}

const snapshot = async () => ({
  students: (await db.prepare("SELECT * FROM students ORDER BY id").all()).results,
  applications: (await db.prepare("SELECT * FROM applications ORDER BY id").all()).results,
  enrollments: (await db.prepare("SELECT id, student_id, class_id FROM enrollments ORDER BY id").all()).results,
});

describe("migration 0034: students and applications with optional details", () => {
  it("keeps every row, id and link as they were, and the rules after it are the relaxed ones", async () => {
    const fixture = await classWith("plus2", 3);
    const levelPublic = fixture.levelId;
    const walk = await registerWalkIn(db, auditKey, env.DATA_KEY, coordinator.publicId, {
      firstName: "Mina",
      lastName: "Thapa",
      dob: "2008-05-14",
      phone: "9801234567",
      email: `mina.${crypto.randomUUID().slice(0, 6)}@example.com`,
      guardianName: "Hari Thapa",
      guardianPhone: "9801234568",
      levelId: levelPublic,
      classId: fixture.classId,
    });
    expect(walk.ok).toBe(true);

    const before = await snapshot();
    expect(before.students.length).toBeGreaterThan(3);
    expect(before.applications.length).toBeGreaterThan(0);

    await db.batch(migrationQueries().map((q) => db.prepare(q)));

    expect(await snapshot()).toEqual(before);
    // Every enrolment still points at a student, and an approved application at its student.
    expect((await db.prepare("SELECT COUNT(*) AS n FROM enrollments e LEFT JOIN students s ON s.id = e.student_id WHERE s.id IS NULL").first<{ n: number }>())!.n).toBe(0);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM applications a LEFT JOIN students s ON s.id = a.student_id WHERE a.student_id IS NOT NULL AND s.id IS NULL").first<{ n: number }>())!.n).toBe(0);
    expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  });

  it("the rebuilt tables take a name alone, but still refuse an empty first name and a malformed date", async () => {
    const at = new Date().toISOString();
    const insert = (first: string, dob: string | null) =>
      db
        .prepare("INSERT INTO students (public_id, sid, first_name, dob_ad, admission_bs_year, created_at) VALUES (?1, ?2, ?3, ?4, 2083, ?5)")
        .bind(crypto.randomUUID().replaceAll("-", ""), `T-${crypto.randomUUID().slice(0, 8)}`, first, dob, at)
        .run();
    await insert("Gita", null);
    const row = await db.prepare("SELECT last_name, guardian_name, guardian_phone, dob_ad FROM students WHERE first_name = 'Gita' ORDER BY id DESC").first();
    expect(row).toEqual({ last_name: "", guardian_name: "", guardian_phone: "", dob_ad: null });
    await expect(insert("", null)).rejects.toThrow();
    await expect(insert("Hari", "14-05-2008")).rejects.toThrow();
  });
});
