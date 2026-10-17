import { beforeAll, describe, expect, it } from "vitest";

import { nepalDate } from "../src/core/dates";
import { recordScan, type ScanOptions, type ScanOutcome } from "../src/modules/gate";
import { call, count, db, person, type Person } from "./academics-helpers";
import { makeAccount, signInComputer } from "./gate-helpers";
import { classWith, setModule, teacherIn, type ClassFixture } from "./schoolday-helpers";

/**
 * The gate (D-175, slice 2 of tap attendance). A gate computer holds a secret key; each card tap it sends is one
 * insert-only scan. A first tap on a school day marks the student Present, or the teacher Present, as the gate device;
 * a repeat changes nothing; unknown, retired and inactive cards mark nothing. A tap sent twice is one tap.
 */

let plus2: ClassFixture;
let coordinator: Person, admin: Person, accountant: Person, teacher: Person, otherTeacher: Person;
let key: string;

const now = new Date();
const today = nepalDate(now);
const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
/** A weekly holiday that is not today, so a school day; and one that is today. */
const SCHOOL_DAY: ScanOptions = { weeklyHoliday: (weekday + 1) % 7 };
const HOLIDAY: ScanOptions = { weeklyHoliday: weekday };

let serial = 0;
const fresh = () => `C${(++serial).toString(16).toUpperCase().padStart(6, "0")}${Math.random().toString(16).slice(2, 6).toUpperCase()}`;
const scanId = () => `scan-${crypto.randomUUID()}`;

const link = (kind: "students" | "people", id: string, cookie: string, cardNumber: string) =>
  call(`/api/cards/${kind}/${id}`, { method: "PUT", cookie, body: { cardNumber } });
const tap = async (cardNumber: string, extra: { scanId?: string; at?: Date; options?: ScanOptions; key?: string } = {}): Promise<ScanOutcome> =>
  recordScan(db, extra.key ?? key, { cardNumber, scanId: extra.scanId ?? scanId(), ...(extra.at ? { at: extra.at.toISOString() } : {}) }, now, extra.options ?? SCHOOL_DAY);
const studentRow = (enrollmentId: string) =>
  db.prepare("SELECT a.status, u.full_name AS marker FROM student_attendance a JOIN enrollments e ON e.id = a.enrollment_id JOIN users u ON u.id = a.marked_by_user_id WHERE e.public_id = ?1 AND a.on_date = ?2").bind(enrollmentId, today).first<{ status: string; marker: string }>();

beforeAll(async () => {
  await setModule("card_attendance", true);
  plus2 = await classWith("plus2", 8);
  coordinator = await person("coordinator", "institution");
  admin = await person("admin", "institution");
  accountant = await person("accountant", "institution");
  teacher = await teacherIn("plus2");
  otherTeacher = await teacherIn("plus2");
  const account = await makeAccount(admin, "Main gate");
  const signedIn = await signInComputer(account);
  if (!signedIn.ok) throw new Error("the gate computer could not sign in");
  key = signedIn.key;
});

describe("a scan through the real route", () => {
  it("works the same as through the service, and a wrong key is refused without recording anything", async () => {
    const number = fresh();
    await link("students", plus2.pupils[7]!.studentId, coordinator.cookie, number);
    const response = await call("/api/gate/scan", { method: "POST", headers: { "x-gate-key": key }, body: { cardNumber: number.toLowerCase(), scanId: scanId() } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: string; person: { name: string } | null };
    // On a Saturday in Nepal this is the weekly holiday; any other day it is a first tap.
    expect(["marked", "no_school"]).toContain(body.result);
    expect(body.person?.name).toContain("Sita");

    const before = await count("SELECT COUNT(*) AS n FROM card_scans");
    const bad = await call("/api/gate/scan", { method: "POST", headers: { "x-gate-key": "gk_nonsense" }, body: { cardNumber: "ABCD1234", scanId: scanId() } });
    expect(bad.status).toBe(401);
    expect(await count("SELECT COUNT(*) AS n FROM card_scans")).toBe(before);
  });
});

describe("a student taps", () => {
  it("the first tap marks Present as the gate; the tap is recorded with its time", async () => {
    const pupil = plus2.pupils[0]!;
    const number = fresh();
    await link("students", pupil.studentId, coordinator.cookie, number);
    const out = await tap(number);
    expect(out.result).toBe("marked");
    expect(out.person).toMatchObject({ kind: "student", name: expect.stringContaining("Sita") });
    expect(await studentRow(pupil.enrollmentId)).toEqual({ status: "present", marker: "Main gate" });
    expect(await count("SELECT COUNT(*) AS n FROM card_scans s JOIN students st ON st.id = s.student_id WHERE st.public_id = ?1 AND s.result = 'marked'", pupil.studentId)).toBe(1);
  });

  it("a repeat tap the same day changes nothing, says when the first was, and is itself recorded", async () => {
    const pupil = plus2.pupils[1]!;
    const number = fresh();
    await link("students", pupil.studentId, coordinator.cookie, number);
    const first = await tap(number);
    const again = await tap(number);
    expect(again.result).toBe("again");
    expect(again.firstAt).toBe(first.at);
    expect(await count("SELECT COUNT(*) AS n FROM student_attendance a JOIN enrollments e ON e.id = a.enrollment_id WHERE e.public_id = ?1", pupil.enrollmentId)).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM card_scans s JOIN students st ON st.id = s.student_id WHERE st.public_id = ?1", pupil.studentId)).toBe(2);
  });

  it("a tap that arrives twice with the same scan id is one tap, and gets the same answer", async () => {
    const pupil = plus2.pupils[2]!;
    const number = fresh();
    await link("students", pupil.studentId, coordinator.cookie, number);
    const id = scanId();
    const one = await tap(number, { scanId: id });
    const two = await tap(number, { scanId: id });
    expect(two).toEqual(one);
    expect(await count("SELECT COUNT(*) AS n FROM card_scans s JOIN students st ON st.id = s.student_id WHERE st.public_id = ?1", pupil.studentId)).toBe(1);
  });

  it("overrides an earlier Absent mark made by hand the same day: the card is the evidence", async () => {
    const pupil = plus2.pupils[3]!;
    const number = fresh();
    await link("students", pupil.studentId, coordinator.cookie, number);
    await db.prepare("INSERT INTO student_attendance (enrollment_id, on_date, status, marked_by_user_id, marked_at, updated_at) SELECT e.id, ?2, 'absent', u.id, ?3, ?3 FROM enrollments e, users u WHERE e.public_id = ?1 AND u.public_id = ?4").bind(pupil.enrollmentId, today, now.toISOString(), coordinator.publicId).run();
    expect((await tap(number)).result).toBe("marked");
    expect((await studentRow(pupil.enrollmentId))?.status).toBe("present");
  });

  it("on the weekly holiday nothing is marked, but the tap is recorded", async () => {
    const pupil = plus2.pupils[4]!;
    const number = fresh();
    await link("students", pupil.studentId, coordinator.cookie, number);
    expect((await tap(number, { options: HOLIDAY })).result).toBe("no_school");
    expect(await studentRow(pupil.enrollmentId)).toBeNull();
    expect(await count("SELECT COUNT(*) AS n FROM card_scans s JOIN students st ON st.id = s.student_id WHERE st.public_id = ?1 AND s.result = 'no_school'", pupil.studentId)).toBe(1);
  });

  it("a student with no class this term is recorded, not marked", async () => {
    const lone = await person("student", "own");
    const id = crypto.randomUUID().replaceAll("-", "");
    await db.prepare("INSERT INTO students (public_id, sid, user_id, first_name, last_name, dob_ad, guardian_name, guardian_phone, admission_bs_year, created_at) SELECT ?1, ?2, id, 'Lone', 'Student', '2008-01-01', 'G', '9800000002', 2083, ?3 FROM users WHERE public_id = ?4").bind(id, `2083-99${serial}`, now.toISOString(), lone.publicId).run();
    const number = fresh();
    expect((await link("students", id, coordinator.cookie, number)).status).toBe(200);
    expect((await tap(number)).result).toBe("recorded");
  });
});

describe("cards that do not count", () => {
  it("an unknown card is recorded and marks nothing", async () => {
    const number = fresh();
    const out = await tap(number);
    expect(out.result).toBe("unknown");
    expect(out.person).toBeNull();
    expect(await count("SELECT COUNT(*) AS n FROM card_scans WHERE card_number = ?1 AND result = 'unknown' AND card_id IS NULL", number.toUpperCase())).toBe(1);
  });

  it("a retired card is refused, and so is a card whose student has left", async () => {
    const pupil = plus2.pupils[5]!;
    const old = fresh();
    await link("students", pupil.studentId, coordinator.cookie, old);
    await call(`/api/cards/students/${pupil.studentId}`, { method: "PUT", cookie: coordinator.cookie, body: { cardNumber: fresh(), reason: "Lost" } });
    expect((await tap(old)).result).toBe("retired");

    const leaver = (await classWith("plus2", 1)).pupils[0]!;
    const number = fresh();
    await link("students", leaver.studentId, coordinator.cookie, number);
    await db.prepare("UPDATE students SET status = 'left' WHERE public_id = ?1").bind(leaver.studentId).run();
    expect((await tap(number)).result).toBe("inactive");
    expect(await studentRow(leaver.enrollmentId)).toBeNull();
  });
});

describe("staff tap", () => {
  it("a teacher's first tap marks them Present, replacing an Absent mark", async () => {
    const number = fresh();
    await link("people", teacher.publicId, coordinator.cookie, number);
    await db.prepare("INSERT INTO teacher_attendance (user_id, on_date, status, marked_by_user_id, marked_at, updated_at) SELECT t.id, ?2, 'absent', c.id, ?3, ?3 FROM users t, users c WHERE t.public_id = ?1 AND c.public_id = ?4").bind(teacher.publicId, today, now.toISOString(), coordinator.publicId).run();
    const out = await tap(number);
    expect(out.result).toBe("marked");
    expect(out.person).toMatchObject({ kind: "staff", role: "teacher" });
    const row = await db.prepare("SELECT a.status, m.full_name AS marker FROM teacher_attendance a JOIN users t ON t.id = a.user_id JOIN users m ON m.id = a.marked_by_user_id WHERE t.public_id = ?1 AND a.on_date = ?2").bind(teacher.publicId, today).first<{ status: string; marker: string }>();
    expect(row).toEqual({ status: "present", marker: "Main gate" });
    expect((await tap(number)).result).toBe("again");
  });

  it("other staff, who have no attendance list, are recorded and welcomed but nothing is marked", async () => {
    const number = fresh();
    await link("people", accountant.publicId, admin.cookie, number);
    const out = await tap(number);
    expect(out.result).toBe("recorded");
    expect(out.person).toMatchObject({ kind: "staff", role: "accountant" });
    expect(await count("SELECT COUNT(*) AS n FROM teacher_attendance a JOIN users u ON u.id = a.user_id WHERE u.public_id = ?1", accountant.publicId)).toBe(0);
  });

  it("a teacher switched off is refused", async () => {
    const number = fresh();
    await link("people", otherTeacher.publicId, coordinator.cookie, number);
    await db.prepare("UPDATE users SET is_active = 0 WHERE public_id = ?1").bind(otherTeacher.publicId).run();
    expect((await tap(number)).result).toBe("inactive");
  });
});

describe("taps kept offline and other edge cases", () => {
  it("a tap from an earlier day is recorded under its own day, but marks nothing today", async () => {
    const pupil = plus2.pupils[6]!;
    const number = fresh();
    await link("students", pupil.studentId, coordinator.cookie, number);
    const yesterday = new Date(now.getTime() - 26 * 60 * 60 * 1000);
    const out = await tap(number, { at: yesterday });
    expect(out.result).toBe("recorded");
    expect(await studentRow(pupil.enrollmentId)).toBeNull();
    const row = await db.prepare("SELECT s.on_date, s.scanned_at, s.received_at FROM card_scans s JOIN students st ON st.id = s.student_id WHERE st.public_id = ?1").bind(pupil.studentId).first<{ on_date: string; scanned_at: string; received_at: string }>();
    expect(row?.on_date).toBe(nepalDate(yesterday));
    expect(row?.scanned_at).toBe(yesterday.toISOString());
    expect(row?.received_at).toBe(now.toISOString());
    // Today's real first tap still counts afterwards.
    expect((await tap(number)).result).toBe("marked");
  });

  it("a tap time in the future is taken as now; one older than a week is refused", async () => {
    const number = fresh();
    const future = await tap(number, { at: new Date(now.getTime() + 3 * 60 * 60 * 1000) });
    expect(future.at).toBe(now.toISOString());
    await expect(tap(number, { at: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000) })).resolves.toMatchObject({ rejected: "too_old" });
  });

  it("with student attendance switched off a known student is recorded, not marked", async () => {
    const pupil = (await classWith("plus2", 1)).pupils[0]!;
    const number = fresh();
    await link("students", pupil.studentId, coordinator.cookie, number);
    await setModule("attendance", false);
    const out = await tap(number);
    await setModule("attendance", true);
    expect(out.result).toBe("recorded");
    expect(await studentRow(pupil.enrollmentId)).toBeNull();
  });

  it("refuses a malformed scan id or card number", async () => {
    await expect(recordScan(db, key, { cardNumber: "ABCD1234", scanId: "short" }, now, SCHOOL_DAY)).resolves.toMatchObject({ rejected: "invalid" });
    await expect(recordScan(db, key, { cardNumber: "", scanId: scanId() }, now, SCHOOL_DAY)).resolves.toMatchObject({ rejected: "invalid" });
  });
});

describe("the database itself", () => {
  it("never changes or deletes a scan, or deletes a device", async () => {
    await expect(db.prepare("UPDATE card_scans SET result = 'marked'").run()).rejects.toThrow(/never changed/);
    await expect(db.prepare("DELETE FROM card_scans").run()).rejects.toThrow(/never deleted/);
    await expect(db.prepare("DELETE FROM gate_devices").run()).rejects.toThrow(/never deleted/);
    await expect(db.prepare("UPDATE gate_devices SET key_hash = 'x'").run()).rejects.toThrow(/last seen/);
    await expect(db.prepare("DELETE FROM gate_accounts").run()).rejects.toThrow(/never deleted/);
    await expect(db.prepare("UPDATE gate_accounts SET gate_id = 'gate-other'").run()).rejects.toThrow(/keeps its ID/);
  });
});
