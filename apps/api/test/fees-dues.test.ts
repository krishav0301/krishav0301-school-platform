import { beforeAll, describe, expect, it } from "vitest";

import { formatNpr } from "../src/modules/fees/money";
import { call, count, db, person, seedSections, type Person } from "./academics-helpers";
import { classWith, type ClassFixture } from "./schoolday-helpers";

/**
 * Dues, the fee report and overdue reminders (Phase 6, slice 5, D-078). CLAUDE.md section 6: NPR shown with Nepali
 * grouping; section 7: notifications one record per event and recipient with a unique key, from a job, SMS only for
 * four events (fee overdue among them, which waits for the SMS adapter; email now). Source 6.5: reports with Excel
 * export (fees: total, paid, remaining, discounts, the student-wise dues list).
 */

let fixture: ClassFixture;
let accountant: Person, admin: Person, coordinator: Person;
const post = (path: string, body: unknown, who: Person) => call(path, { method: "POST", body, cookie: who.cookie });

beforeAll(async () => {
  await seedSections();
  // An email names the school, so the school must exist for one to be delivered.
  await db.prepare("INSERT OR IGNORE INTO school (id, name, short_name) VALUES (1, 'Sample College', 'Sample')").run();
  accountant = await person("accountant", "institution");
  admin = await person("admin", "institution");
  coordinator = await person("coordinator", "institution");
  fixture = await classWith("plus2", 3);
  const structure = ((await (await post("/api/fees/structures", { levelId: fixture.levelId }, accountant)).json()) as { id: string }).id;
  await post(`/api/fees/structures/${structure}/items`, { name: "Annual fee", amountPaisa: 125_000_000, frequency: "yearly" }, accountant);
  await post(`/api/fees/structures/${structure}/send`, {}, accountant);
  const request = (await db.prepare("SELECT public_id FROM approval_requests WHERE subject_public_id = ?1").bind(structure).first<{ public_id: string }>())!.public_id;
  await post(`/api/approvals/${request}/approve`, undefined, admin);
  await post(`/api/fees/structures/${structure}/charges`, { classId: fixture.classId }, accountant);
  // Pupil 0 pays in full; pupil 1 pays part; pupil 2 pays nothing and has an email address.
  await post("/api/fees/payments/cash", { enrollmentId: fixture.pupils[0]!.enrollmentId, amountPaisa: 125_000_000, idempotencyKey: crypto.randomUUID().replace(/-/g, "") }, accountant);
  await post("/api/fees/payments/cash", { enrollmentId: fixture.pupils[1]!.enrollmentId, amountPaisa: 25_000_000, idempotencyKey: crypto.randomUUID().replace(/-/g, "") }, accountant);
  await db.prepare("UPDATE students SET email = 'pupil2@example.com' WHERE public_id = ?1").bind(fixture.pupils[2]!.studentId).run();
});

describe("NPR", () => {
  it("is written with Nepali grouping, from whole paisa, without floats", () => {
    expect(formatNpr(125_000_000)).toBe("12,50,000.00");
    expect(formatNpr(1_000_000_000)).toBe("1,00,00,000.00");
    expect(formatNpr(99)).toBe("0.99");
    expect(formatNpr(100_050)).toBe("1,000.50");
    expect(formatNpr(-5_000)).toBe("-50.00");
    expect(() => formatNpr(1.5)).toThrow();
  });
});

describe("the dues list", () => {
  it("gives each student's charged, paid, due and overdue, and the totals", async () => {
    const response = await call(`/api/fees/dues?classId=${fixture.classId}`, { cookie: accountant.cookie });
    expect(response.status).toBe(200);
    const list = (await response.json()) as { students: { enrollmentId: string; paidPaisa: number; duePaisa: number; overduePaisa: number }[]; totals: { duePaisa: number } };
    const row = (i: number) => list.students.find((s) => s.enrollmentId === fixture.pupils[i]!.enrollmentId)!;
    expect(row(0)).toMatchObject({ paidPaisa: 125_000_000, duePaisa: 0 });
    expect(row(1)).toMatchObject({ paidPaisa: 25_000_000, duePaisa: 100_000_000, overduePaisa: 100_000_000 });
    expect(list.totals.duePaisa).toBe(225_000_000);
  });

  it("exports as CSV with Nepali grouping, quoting, and no spreadsheet formulas", async () => {
    await db.prepare("UPDATE students SET last_name = '=HYPERLINK(1)' WHERE public_id = ?1").bind(fixture.pupils[0]!.studentId).run();
    const response = await call(`/api/fees/dues.csv?classId=${fixture.classId}`, { cookie: admin.cookie });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/csv");
    const text = await response.text();
    expect(text.split("\r\n")[0]).toContain("SID,Student,Class");
    expect(text).toContain('"12,50,000.00"');
    expect(text).not.toMatch(/(^|,)=HYPERLINK/m);
  });

  it("the Co-ordinator has no fees reports; a student none either", async () => {
    expect((await call("/api/fees/dues", { cookie: coordinator.cookie })).status).toBe(403);
    expect((await call("/api/fees/dues", { cookie: fixture.pupils[0]!.person.cookie })).status).toBe(403);
  });
});

describe("overdue reminders", () => {
  it("email the students with something overdue and an address, once a day however often it is pressed", async () => {
    const before = await count("SELECT COUNT(*) AS n FROM outbox_events WHERE dedupe_key LIKE 'fee_overdue:%'");
    const first = await post("/api/fees/reminders", undefined, accountant);
    expect(first.status).toBe(200);
    expect(((await first.json()) as { queued: number }).queued).toBe(1); // pupil 1 is overdue but has no email
    await post("/api/fees/reminders", undefined, accountant);
    expect(await count("SELECT COUNT(*) AS n FROM outbox_events WHERE dedupe_key LIKE 'fee_overdue:%'")).toBe(before + 1);
    const mail = await db.prepare("SELECT body FROM dev_mailbox WHERE to_email = 'pupil2@example.com' ORDER BY id DESC LIMIT 1").first<{ body: string }>();
    expect(mail?.body ?? "").toContain("12,50,000.00");
  });

  it("only the Accountant sends them", async () => {
    for (const who of [admin, coordinator]) expect((await post("/api/fees/reminders", undefined, who)).status).toBe(403);
  });
});
