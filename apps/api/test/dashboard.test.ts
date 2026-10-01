import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { requestApproval } from "../src/modules/approvals/service";
import { createContent, publishContent } from "../src/modules/content/service";
import { dashboardOverview, UNMARKED_FROM_HOUR } from "../src/modules/dashboard/service";
import { ledgerInserts, writeMoney, type LedgerDraft } from "../src/modules/fees/ledger";
import { auditKey, call, db, person, seedSections, type Person } from "./academics-helpers";
import { classWith, type ClassFixture } from "./schoolday-helpers";

/**
 * The Principal's dashboard (D-088): who may see it, and that every figure is the database's own. The service is
 * called with a fixed moment so the "vs last month" windows, the noon register rule and Saturdays are exact.
 * 2026-09-30 is a Wednesday; 08:00 UTC is 13:45 in Nepal, after the register cut-off.
 */
const WEDNESDAY_AFTERNOON = new Date("2026-09-30T08:00:00.000Z");
const WEDNESDAY_MORNING = new Date("2026-09-30T03:00:00.000Z"); // 08:45 in Nepal
const SATURDAY_AFTERNOON = new Date("2026-10-03T08:00:00.000Z");

let admin: Person, support: Person, coordinator: Person;
const overview = (now = WEDNESDAY_AFTERNOON) => dashboardOverview(db, { SITE_ORIGIN: "https://school.example" }, now);

beforeAll(async () => {
  await seedSections();
  admin = await person("admin", "institution");
  support = await person("super_admin", "institution");
  coordinator = await person("coordinator", "institution");
});

describe("who sees the dashboard", () => {
  it("the Admin and Support; every other role is refused and a signed-out visitor must sign in", async () => {
    for (const who of [admin, support]) {
      const response = await call("/api/dashboard/overview", { cookie: who.cookie });
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
    for (const role of ["coordinator", "accountant", "teacher", "student"] as const) {
      const who = await person(role, role === "student" ? "own" : role === "teacher" ? "assigned" : "institution");
      expect((await call("/api/dashboard/overview", { cookie: who.cookie })).status, role).toBe(403);
    }
    expect((await call("/api/dashboard/overview")).status).toBe(401);
  });
});

describe("an empty school", () => {
  it("is on track, with zeros and no percentages rather than made-up ones", async () => {
    const d = await overview();
    expect(d.status).toBe("on_track");
    expect(d.students).toEqual({ total: 0, changePercent: null });
    expect(d.attendance).toMatchObject({ percent: null, present: 0, marked: 0, enrolled: 0, trend: [], byProgramme: [] });
    expect(d.fees).toMatchObject({ collectedPaisa: 0, changePercent: null, duePaisa: 0 });
    expect(d.attention).toEqual({ approvals: { count: 0, kinds: [] }, feeFollowUps: 0, anomalies: { count: 0, classes: [] }, websiteDrafts: 0 });
    expect(d.programmes).toEqual([]);
    expect(d.activity).toEqual([]);
    expect(d.website).toMatchObject({ origin: "https://school.example", drafts: 0, live: 0 });
  });
});

describe("a school with a day's worth of data", () => {
  let marked: ClassFixture, unmarked: ClassFixture;

  beforeAll(async () => {
    marked = await classWith("plus2", 4);
    unmarked = await classWith("bachelors", 2);
    // Grade A today: 2 of 4 present (50%, below the 75% alert line). Yesterday: all 4 present.
    const mark = (enrollmentId: string, date: string, status: "present" | "absent") =>
      db
        .prepare(
          `INSERT INTO student_attendance (enrollment_id, on_date, status, marked_by_user_id, marked_at, updated_at)
           SELECT en.id, ?2, ?3, u.id, ?4, ?4 FROM enrollments en, users u WHERE en.public_id = ?1 AND u.public_id = ?5`,
        )
        .bind(enrollmentId, date, status, `${date}T04:00:00.000Z`, marked.classTeacher.publicId)
        .run();
    // The "today only" trigger (tested in attendance.test.ts) would refuse these fixed past days, so it is set aside
    // for the insert only and put back exactly as the migration stored it.
    const trigger = (await db.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'student_attendance_today_insert'").first<{ sql: string }>())!.sql;
    await db.prepare("DROP TRIGGER student_attendance_today_insert").run();
    try {
      for (const [i, p] of marked.pupils.entries()) {
        await mark(p.enrollmentId, "2026-09-29", "present");
        await mark(p.enrollmentId, "2026-09-30", i < 2 ? "present" : "absent");
      }
    } finally {
      await db.prepare(trigger).run();
    }

    // Money: pupil 0 owes 10,000 paisa carried from before (due 1 Sep) and paid 4,000 on 25 Sep (this window);
    // pupil 1 paid 1,000 on 15 Aug (the window before). Only pupil 0 has anything overdue.
    const entry = (over: Partial<LedgerDraft> & Pick<LedgerDraft, "enrollmentPublicId" | "kind" | "amountPaisa" | "createdAt">): LedgerDraft => ({
      publicId: crypto.randomUUID().replace(/-/g, ""),
      actorPublicId: admin.publicId,
      ...over,
    });
    const drafts = [
      entry({ enrollmentPublicId: marked.pupils[0]!.enrollmentId, kind: "carried_dues", amountPaisa: 10_000, dueOn: "2026-09-01", createdAt: "2026-07-20T00:00:00.000Z" }),
      entry({ enrollmentPublicId: marked.pupils[0]!.enrollmentId, kind: "payment", amountPaisa: -4_000, createdAt: "2026-09-25T00:00:00.000Z" }),
      entry({ enrollmentPublicId: marked.pupils[1]!.enrollmentId, kind: "payment", amountPaisa: -1_000, createdAt: "2026-08-15T00:00:00.000Z" }),
      // Pupil 2 owes 3,000 not due until December: due, but not overdue, so not a follow-up.
      entry({ enrollmentPublicId: marked.pupils[2]!.enrollmentId, kind: "carried_dues", amountPaisa: 3_000, dueOn: "2026-12-01", createdAt: "2026-07-20T00:00:00.000Z" }),
    ];
    await writeMoney(db, auditKey, { action: "test.money", entityType: "ledger", actorPublicId: admin.publicId, summary: "test" }, async (head) => (await ledgerInserts(db, auditKey, head, drafts)).statements);

    // The website: a draft the Admin has not published, a notice the Co-ordinator sent for approval, and one published.
    const notice = (title: string) => ({ kind: "notice" as const, title, body: "Body text.", contact: null, urgent: false, publishOn: "2026-09-30", hideAfter: null });
    const draft = await createContent(db, auditKey, admin.publicId, notice("A draft"));
    if (!draft.ok) throw new Error(`content setup: ${JSON.stringify(draft)}`);
    const sent = await createContent(db, auditKey, coordinator.publicId, notice("Sent for approval"));
    if (!sent.ok) throw new Error("content setup");
    expect((await requestApproval(db, auditKey, coordinator.publicId, { kind: "website_content", subjectId: sent.publicId })).ok).toBe(true);
    const live = await createContent(db, auditKey, support.publicId, notice("Published by Support"));
    if (!live.ok) throw new Error("content setup");
    expect((await publishContent(db, auditKey, support.publicId, live.publicId)).ok).toBe(true);
  });

  it("counts students and staff from the database, with the change since a month ago", async () => {
    const d = await overview();
    expect(d.students.total).toBe(6);
    // Every enrollment here was made on 22 Sep, inside the window: there was no one a month ago to compare with.
    expect(d.students.changePercent).toBeNull();
    // A month later, the same six students: no change.
    expect((await overview(new Date("2026-10-30T08:00:00.000Z"))).students).toEqual({ total: 6, changePercent: 0 });
    expect(d.staff.total).toBeGreaterThanOrEqual(3); // the two Class Teachers and the Co-ordinator, at least
  });

  it("today's attendance, the day before, the trend oldest first, and each programme today", async () => {
    const d = await overview();
    expect(d.attendance).toMatchObject({ percent: 50, present: 2, marked: 4, enrolled: 6, previousPercent: 100 });
    expect(d.attendance.trend.map((t) => [t.date, t.percent])).toEqual([
      ["2026-09-29", 100],
      ["2026-09-30", 50],
    ]);
    expect(d.attendance.trend[0]!.dateBs).toMatch(/^2083-/);
    const byName = Object.fromEntries(d.attendance.byProgramme.map((p) => [p.name, p]));
    expect(Object.values(byName).map((p) => p.percent).sort()).toEqual([50, null]);
  });

  it("flags a class below the alert line, and from noon a class with no register; never before noon or on a Saturday", async () => {
    const afternoon = await overview();
    const kinds = Object.fromEntries(afternoon.attention.anomalies.classes.map((c) => [c.id, c.kind]));
    expect(kinds).toEqual({ [marked.classId]: "low", [unmarked.classId]: "unmarked" });
    expect(afternoon.attention.anomalies.classes.find((c) => c.kind === "low")!.percent).toBe(50);

    const morning = await overview(WEDNESDAY_MORNING);
    expect(UNMARKED_FROM_HOUR).toBe(12);
    expect(morning.attention.anomalies.classes.map((c) => c.kind)).toEqual(["low"]);

    expect((await overview(SATURDAY_AFTERNOON)).attention.anomalies.count).toBe(0);
  });

  it("fees: money taken this month against last month, net, and the students with anything overdue", async () => {
    const d = await overview();
    expect(d.fees).toMatchObject({ collectedPaisa: 4_000, changePercent: 300, chargedPaisa: 13_000, paidPaisa: 5_000, duePaisa: 9_000, overduePaisa: 6_000 });
    expect(d.attention.feeFollowUps).toBe(1);
  });

  it("approvals waiting, website drafts, the site's last publish, and recent activity with Support never named", async () => {
    const d = await overview();
    expect(d.attention.approvals).toEqual({ count: 1, kinds: [{ kind: "website_content", count: 1 }] });
    expect(d.attention.websiteDrafts).toBe(1);
    expect(d.website).toMatchObject({ drafts: 1, waiting: 1, live: 1 });
    expect(d.website.lastPublishedAt).not.toBeNull();
    const published = d.activity.find((a) => a.action === "content.published")!;
    expect(published).toMatchObject({ entityType: "content_item", actorIsSupport: true, actorName: null });
    expect(d.activity.some((a) => a.action === "test.money")).toBe(false); // only the events the Principal cares about
  });

  it("programmes with this year's classes and students; the overall status counts each kind of thing waiting", async () => {
    const d = await overview();
    expect(d.programmes.map((p) => p.students).sort()).toEqual([2, 4]);
    expect(d.programmes.every((p) => p.classes === 1 && p.levels === 1)).toBe(true);
    // Approvals, a fee follow-up, attendance anomalies and a website draft: four kinds waiting.
    expect(d.status).toBe("several");
  });
});

it("the same figures reach the Admin through the route", async () => {
  const body = (await (await call("/api/dashboard/overview", { cookie: admin.cookie })).json()) as { students: { total: number } };
  expect(body.students.total).toBe((await overview()).students.total);
  expect(env.AUDIT_HMAC_KEY).toBeTruthy();
});
