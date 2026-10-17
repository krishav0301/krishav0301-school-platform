import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { auditActions, auditKey, call, count, db, person, type Person } from "./academics-helpers";
import { classWith, setModule, teacherIn, type ClassFixture } from "./schoolday-helpers";

/**
 * RFID cards, slice 1 of tap attendance (D-174): which card number belongs to which person. The Co-ordinator links
 * students' and teachers' cards, the Admin the Co-ordinators' and Accountants', the Super Admin anyone's. A number is
 * one person's forever; a person has one active card; a lost card is retired and replaced, never deleted. The module is
 * off unless a school switches it on.
 */

interface CardView {
  owner: { kind: "student" | "person"; name: string };
  current: { cardNumber: string; issuedAt: string; usable: boolean } | null;
  history: { cardNumber: string; issuedAt: string; retiredAt: string; reason: string }[];
}

let plus2: ClassFixture, bachelors: ClassFixture;
let coordinator: Person, plus2Coordinator: Person, bachelorsCoordinator: Person, admin: Person, accountant: Person, superAdmin: Person;
let plus2Teacher: Person, bachelorsTeacher: Person, otherCoordinator: Person, otherAccountant: Person;

let serial = 0;
/** A fresh card number every call, so tests never collide. */
const fresh = () => `A${(++serial).toString(16).toUpperCase().padStart(6, "0")}${Math.random().toString(16).slice(2, 6).toUpperCase()}`;

const studentOf = (fixture: ClassFixture, i = 0) => fixture.pupils[i]!.studentId;
const link = (kind: "students" | "people", id: string, cookie: string, body: unknown) => call(`/api/cards/${kind}/${id}`, { method: "PUT", cookie, body });
const retire = (kind: "students" | "people", id: string, cookie: string, body: unknown) => call(`/api/cards/${kind}/${id}/retire`, { method: "POST", cookie, body });
const view = async (kind: "students" | "people", id: string, cookie: string) => call(`/api/cards/${kind}/${id}`, { cookie });
const viewOf = async (kind: "students" | "people", id: string, cookie: string) => (await (await view(kind, id, cookie)).json()) as CardView;

beforeAll(async () => {
  await setModule("card_attendance", true);
  plus2 = await classWith("plus2", 4);
  bachelors = await classWith("bachelors", 2);
  coordinator = await person("coordinator", "institution");
  plus2Coordinator = await person("coordinator", "section", "plus2");
  bachelorsCoordinator = await person("coordinator", "section", "bachelors");
  otherCoordinator = await person("coordinator", "institution");
  admin = await person("admin", "institution");
  accountant = await person("accountant", "institution");
  otherAccountant = await person("accountant", "institution");
  superAdmin = await person("super_admin", "institution");
  plus2Teacher = await teacherIn("plus2");
  bachelorsTeacher = await teacherIn("bachelors");
});

describe("linking a card", () => {
  it("links a card to a student, upper-cased, and shows it", async () => {
    const id = studentOf(plus2, 0);
    const response = await link("students", id, coordinator.cookie, { cardNumber: "04a1b2c3" });
    expect(response.status).toBe(200);
    const body = await viewOf("students", id, coordinator.cookie);
    expect(body.current?.cardNumber).toBe("04A1B2C3");
    expect(body.current?.usable).toBe(true);
    expect(body.history).toEqual([]);
  });

  it("trims a number the reader typed with a stray space", async () => {
    const id = studentOf(plus2, 1);
    expect((await link("students", id, coordinator.cookie, { cardNumber: " 0099887766 " })).status).toBe(200);
    expect((await viewOf("students", id, coordinator.cookie)).current?.cardNumber).toBe("0099887766");
  });

  it.each(["abc", "12 34 56", "ab-cd12", "x".repeat(33), ""])("refuses the number %j", async (cardNumber) => {
    const response = await link("students", studentOf(plus2, 2), coordinator.cookie, { cardNumber });
    expect(response.status).toBe(422);
  });

  it("writes one audit entry for the link, and the chain still verifies", async () => {
    const id = studentOf(plus2, 2);
    expect(await auditActions(id)).not.toContain("cards.linked");
    await link("students", id, coordinator.cookie, { cardNumber: fresh() });
    expect(await auditActions(id)).toContain("cards.linked");
    expect((await verifyAuditChain(db, auditKey)).ok).toBe(true);
  });

  it("links a card to a teacher through the people path", async () => {
    const response = await link("people", plus2Teacher.publicId, coordinator.cookie, { cardNumber: fresh() });
    expect(response.status).toBe(200);
    expect((await viewOf("people", plus2Teacher.publicId, coordinator.cookie)).current).not.toBeNull();
  });

  it("refuses a number another person already has, and records nothing", async () => {
    const number = fresh();
    await link("students", studentOf(plus2, 3), coordinator.cookie, { cardNumber: number });
    const before = await count("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'cards.linked'");
    const response = await link("students", studentOf(bachelors, 0), coordinator.cookie, { cardNumber: number });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "card_in_use" });
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'cards.linked'")).toBe(before);
  });

  it("is safe to repeat: the same number on the same person changes nothing and records nothing", async () => {
    const id = studentOf(bachelors, 1);
    const number = fresh();
    expect((await link("students", id, coordinator.cookie, { cardNumber: number })).status).toBe(200);
    const before = await count("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'cards.linked'");
    expect((await link("students", id, coordinator.cookie, { cardNumber: number })).status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'cards.linked'")).toBe(before);
    expect(await count("SELECT COUNT(*) AS n FROM rfid_cards WHERE card_number = ?1", number)).toBe(1);
  });
});

describe("replacing and retiring a card", () => {
  it("a second number needs a reason, retires the first, and keeps the history", async () => {
    const id = plus2Teacher.publicId;
    const first = (await viewOf("people", id, coordinator.cookie)).current!.cardNumber;
    const second = fresh();

    expect((await link("people", id, coordinator.cookie, { cardNumber: second })).status).toBe(422);
    expect((await viewOf("people", id, coordinator.cookie)).current?.cardNumber).toBe(first);

    expect((await link("people", id, coordinator.cookie, { cardNumber: second, reason: "Lost" })).status).toBe(200);
    const body = await viewOf("people", id, coordinator.cookie);
    expect(body.current?.cardNumber).toBe(second);
    expect(body.history.map((h) => [h.cardNumber, h.reason])).toEqual([[first, "Lost"]]);
    expect(await count("SELECT COUNT(*) AS n FROM rfid_cards r JOIN users u ON u.id = r.user_id WHERE u.public_id = ?1 AND r.status = 'active'", id)).toBe(1);
    expect(await auditActions(id)).toContain("cards.replaced");
  });

  it("a retired number can never be linked again, to anyone", async () => {
    const id = studentOf(plus2, 0);
    const old = (await viewOf("students", id, coordinator.cookie)).current!.cardNumber;
    expect((await link("students", id, coordinator.cookie, { cardNumber: fresh(), reason: "Damaged" })).status).toBe(200);
    expect((await link("students", id, coordinator.cookie, { cardNumber: old, reason: "Found it" })).status).toBe(409);
    expect((await link("students", studentOf(plus2, 1), coordinator.cookie, { cardNumber: old, reason: "Found it" })).status).toBe(409);
  });

  it("retires a card with a reason, and a second retire finds nothing", async () => {
    const id = studentOf(plus2, 3);
    expect((await retire("students", id, coordinator.cookie, { reason: "" })).status).toBe(422);
    expect((await retire("students", id, coordinator.cookie, { reason: "Left the card at home for good" })).status).toBe(200);
    expect((await viewOf("students", id, coordinator.cookie)).current).toBeNull();
    expect((await retire("students", id, coordinator.cookie, { reason: "Again" })).status).toBe(404);
    expect(await auditActions(id)).toContain("cards.retired");
  });
});

describe("the database itself", () => {
  it("never deletes a card, never edits its number or owner, and never gives it two owners", async () => {
    const id = studentOf(bachelors, 1);
    await expect(db.prepare("DELETE FROM rfid_cards").run()).rejects.toThrow(/never deleted/);
    await expect(db.prepare("UPDATE rfid_cards SET card_number = 'ZZZZ9999' WHERE student_id = (SELECT id FROM students WHERE public_id = ?1)").bind(id).run()).rejects.toThrow(/only moves/);
    await expect(
      db
        .prepare(
          `INSERT INTO rfid_cards (public_id, card_number, student_id, user_id, issued_at, issued_by_user_id)
           SELECT 'x', 'BOTH0001', s.id, u.id, 'now', u.id FROM students s, users u WHERE s.public_id = ?1 AND u.public_id = ?2`,
        )
        .bind(id, coordinator.publicId)
        .run(),
    ).rejects.toThrow(/CHECK constraint/);
  });

  it("refuses a second active card for one person even if the service is bypassed", async () => {
    const id = studentOf(bachelors, 1);
    await expect(
      db
        .prepare(`INSERT INTO rfid_cards (public_id, card_number, student_id, issued_at, issued_by_user_id) SELECT 'y', 'TWO00001', s.id, 'now', u.id FROM students s, users u WHERE s.public_id = ?1 AND u.public_id = ?2`)
        .bind(id, coordinator.publicId)
        .run(),
    ).rejects.toThrow(/UNIQUE/);
  });
});

describe("whether the card still counts", () => {
  it("is not usable once the student has left, or the user is switched off", async () => {
    const student = (await classWith("plus2", 1)).pupils[0]!;
    await link("students", student.studentId, coordinator.cookie, { cardNumber: fresh() });
    expect((await viewOf("students", student.studentId, coordinator.cookie)).current?.usable).toBe(true);
    await db.prepare("UPDATE students SET status = 'left' WHERE public_id = ?1").bind(student.studentId).run();
    expect((await viewOf("students", student.studentId, coordinator.cookie)).current?.usable).toBe(false);

    const teacher = await teacherIn("plus2");
    await link("people", teacher.publicId, coordinator.cookie, { cardNumber: fresh() });
    await db.prepare("UPDATE users SET is_active = 0 WHERE public_id = ?1").bind(teacher.publicId).run();
    expect((await viewOf("people", teacher.publicId, coordinator.cookie)).current?.usable).toBe(false);
  });
});

describe("who may do what (written by hand from the requirements)", () => {
  it("the Co-ordinator manages students and teachers, not other staff", async () => {
    expect((await link("students", studentOf(plus2, 0), coordinator.cookie, { cardNumber: fresh(), reason: "Lost" })).status).toBe(200);
    expect((await link("people", bachelorsTeacher.publicId, coordinator.cookie, { cardNumber: fresh() })).status).toBe(200);
    expect((await link("people", accountant.publicId, coordinator.cookie, { cardNumber: fresh() })).status).toBe(404);
    expect((await link("people", otherCoordinator.publicId, coordinator.cookie, { cardNumber: fresh() })).status).toBe(404);
    expect((await link("people", admin.publicId, coordinator.cookie, { cardNumber: fresh() })).status).toBe(404);
  });

  it("the Admin manages Co-ordinators and Accountants, not students or teachers or themselves", async () => {
    expect((await link("people", otherCoordinator.publicId, admin.cookie, { cardNumber: fresh() })).status).toBe(200);
    expect((await link("people", accountant.publicId, admin.cookie, { cardNumber: fresh() })).status).toBe(200);
    expect((await link("students", studentOf(plus2, 1), admin.cookie, { cardNumber: fresh(), reason: "Lost" })).status).toBe(404);
    expect((await link("people", plus2Teacher.publicId, admin.cookie, { cardNumber: fresh(), reason: "Lost" })).status).toBe(404);
    expect((await link("people", admin.publicId, admin.cookie, { cardNumber: fresh() })).status).toBe(404);
  });

  it("the Super Admin manages anyone", async () => {
    expect((await link("people", otherAccountant.publicId, superAdmin.cookie, { cardNumber: fresh() })).status).toBe(200);
    expect((await link("people", admin.publicId, superAdmin.cookie, { cardNumber: fresh() })).status).toBe(200);
    expect((await link("students", studentOf(bachelors, 0), superAdmin.cookie, { cardNumber: fresh(), reason: "Lost" })).status).toBe(200);
  });

  it("the Admin can read a card; the Accountant, a teacher and a student cannot see or change any", async () => {
    expect((await view("people", otherCoordinator.publicId, admin.cookie)).status).toBe(200);
    for (const who of [accountant, plus2Teacher, plus2.pupils[0]!.person]) {
      expect((await view("students", studentOf(plus2, 0), who.cookie)).status).toBe(403);
      expect((await link("students", studentOf(plus2, 0), who.cookie, { cardNumber: fresh() })).status).toBe(403);
      expect((await retire("students", studentOf(plus2, 0), who.cookie, { reason: "No right" })).status).toBe(403);
    }
  });

  it("a signed-out caller gets 401", async () => {
    expect((await call(`/api/cards/students/${studentOf(plus2, 0)}`)).status).toBe(401);
  });
});

describe("a section-scoped Co-ordinator reaches only their own section", () => {
  it("links and reads in their section", async () => {
    expect((await link("students", studentOf(plus2, 2), plus2Coordinator.cookie, { cardNumber: fresh(), reason: "Lost" })).status).toBe(200);
    expect((await link("people", plus2Teacher.publicId, plus2Coordinator.cookie, { cardNumber: fresh(), reason: "Lost" })).status).toBe(200);
    expect((await view("students", studentOf(plus2, 2), plus2Coordinator.cookie)).status).toBe(200);
  });

  it("gets nothing from the other section: not a read, not a link, not a retire", async () => {
    expect((await view("students", studentOf(bachelors, 0), plus2Coordinator.cookie)).status).toBe(404);
    expect((await link("students", studentOf(bachelors, 0), plus2Coordinator.cookie, { cardNumber: fresh(), reason: "Lost" })).status).toBe(404);
    expect((await retire("students", studentOf(bachelors, 0), plus2Coordinator.cookie, { reason: "Not mine" })).status).toBe(404);
    expect((await link("people", bachelorsTeacher.publicId, plus2Coordinator.cookie, { cardNumber: fresh(), reason: "Lost" })).status).toBe(404);
    expect((await link("students", studentOf(plus2, 0), bachelorsCoordinator.cookie, { cardNumber: fresh(), reason: "Lost" })).status).toBe(404);
  });
});

describe("the module switch", () => {
  it("answers not found while the module is off, or has never been set, and works again when on", async () => {
    const id = studentOf(plus2, 3);
    await setModule("card_attendance", false);
    expect((await view("students", id, coordinator.cookie)).status).toBe(404);
    expect((await link("students", id, coordinator.cookie, { cardNumber: fresh() })).status).toBe(404);

    await db.prepare("DELETE FROM module_switches WHERE key = 'card_attendance'").run();
    expect((await view("students", id, coordinator.cookie)).status).toBe(404);

    await setModule("card_attendance", true);
    expect((await view("students", id, coordinator.cookie)).status).toBe(200);
  });
});

describe("unknown people", () => {
  it("a person that does not exist is not found", async () => {
    expect((await view("students", "0".repeat(32), coordinator.cookie)).status).toBe(404);
    expect((await link("people", "0".repeat(32), coordinator.cookie, { cardNumber: fresh() })).status).toBe(404);
    expect((await link("students", "not-an-id", coordinator.cookie, { cardNumber: fresh() })).status).toBe(400);
  });

  it("a student's id is not a person's id, and the other way round", async () => {
    expect((await view("people", studentOf(plus2, 0), coordinator.cookie)).status).toBe(404);
    expect((await view("students", plus2Teacher.publicId, coordinator.cookie)).status).toBe(404);
  });
});
