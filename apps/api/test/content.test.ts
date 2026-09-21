import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { nepalDate } from "../src/core/dates";
import { createUser } from "../src/modules/accounts/service";
import { listAdminContent, listPublicContent } from "../src/modules/content/queries";
import { createContent, publishContent, unpublishContent, updateContent } from "../src/modules/content/service";
import type { ContentInput } from "../src/modules/content/schema";

const db = env.DB;
const key = env.AUDIT_HMAC_KEY;
const password = "blue-river-lamp-2083";

let counter = 0;
async function makeUser(role: "admin" | "super_admin" | "coordinator" | "teacher" | "student") {
  const scope = role === "teacher" ? "assigned" : role === "student" ? "own" : "institution";
  const email = `${role}-${++counter}-${crypto.randomUUID().slice(0, 6)}@school.example`;
  const { publicId } = await createUser(db, key, { email, password, fullName: `${role} person`, roles: [{ role, scope }] });
  return publicId;
}

const people = {} as Record<"admin" | "admin2" | "super_admin" | "coordinator" | "teacher" | "student", string>;
beforeAll(async () => {
  people.admin = await makeUser("admin");
  people.admin2 = await makeUser("admin");
  people.super_admin = await makeUser("super_admin");
  people.coordinator = await makeUser("coordinator");
  people.teacher = await makeUser("teacher");
  people.student = await makeUser("student");
});

const TODAY = "2083-01-01"; // an arbitrary AD stand-in; every rule below only compares dates
const notice = (over: Partial<ContentInput> = {}): ContentInput => ({
  kind: "notice",
  title: "Winter break",
  body: "School closes on Friday.",
  contact: null,
  urgent: false,
  publishOn: "2026-09-21",
  hideAfter: null,
  ...over,
});

const auditRows = async (publicId: string) =>
  (await db.prepare("SELECT action, summary, before_json, after_json FROM audit_events WHERE entity_public_id = ?1 ORDER BY id").bind(publicId).all<{ action: string; summary: string; before_json: string | null; after_json: string | null }>()).results;
const statusOf = async (publicId: string) =>
  (await db.prepare("SELECT status FROM content_items WHERE public_id = ?1").bind(publicId).first<{ status: string }>())?.status;

async function created(input: Partial<ContentInput> = {}, actor = people.admin) {
  const result = await createContent(db, key, actor, notice(input));
  if (!result.ok) throw new Error(`create failed: ${result.reason}`);
  return result.publicId;
}
async function live(input: Partial<ContentInput> = {}, actor = people.admin) {
  const id = await created(input, actor);
  const result = await publishContent(db, key, actor, id);
  if (!result.ok) throw new Error(`publish failed: ${result.reason}`);
  return id;
}

// ---------------------------------------------------------------------------------------------
describe("creating content", () => {
  it("an Admin makes a draft, which is audited and is not public", async () => {
    const id = await created({ title: "Fee reminder" });

    expect(await statusOf(id)).toBe("draft");
    const rows = await auditRows(id);
    expect(rows.map((r) => r.action)).toEqual(["content.created"]);
    expect(rows[0]!.summary).toContain("Fee reminder");
    expect((await listPublicContent(db, "2099-01-01")).items.map((i) => i.id)).not.toContain(id);
  });

  it("the Super Admin may too", async () => {
    const result = await createContent(db, key, people.super_admin, notice());
    expect(result.ok).toBe(true);
  });

  it("everyone else is refused, and nothing is written (Co-ordinator drafts arrive in Phase 3)", async () => {
    const before = (await db.prepare("SELECT COUNT(*) AS n FROM content_items").first<{ n: number }>())!.n;
    for (const who of ["coordinator", "teacher", "student"] as const) {
      const result = await createContent(db, key, people[who], notice());
      expect(result, who).toEqual({ ok: false, reason: "not_allowed" });
    }
    expect((await db.prepare("SELECT COUNT(*) AS n FROM content_items").first<{ n: number }>())!.n).toBe(before);
  });

  it("a deactivated Admin, or one whose Admin assignment was switched off, is refused straight away (no waiting for a token to expire)", async () => {
    const gone = await makeUser("admin");
    const off = await makeUser("admin");
    await db.prepare("UPDATE users SET is_active = 0 WHERE public_id = ?1").bind(gone).run();
    await db.prepare("UPDATE role_assignments SET is_active = 0 WHERE user_id = (SELECT id FROM users WHERE public_id = ?1)").bind(off).run();

    expect(await createContent(db, key, gone, notice())).toEqual({ ok: false, reason: "not_allowed" });
    expect(await createContent(db, key, off, notice())).toEqual({ ok: false, reason: "not_allowed" });
  });

  it("a refused write leaves no audit entry behind", async () => {
    const before = (await db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'content.created'").first<{ n: number }>())!.n;
    await createContent(db, key, people.student, notice());
    expect((await db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'content.created'").first<{ n: number }>())!.n).toBe(before);
  });

  it("is refused when the content breaks a rule, with a message, and nothing is written", async () => {
    const bad: [string, Partial<ContentInput>][] = [
      ["empty title", { title: "   " }],
      ["title too long", { title: "x".repeat(201) }],
      ["empty body", { body: "" }],
      ["body too long", { body: "x".repeat(10_001) }],
      ["a vacancy with no contact", { kind: "vacancy", contact: null }],
      ["a contact on a notice", { kind: "notice", contact: "help@school.example" }],
      ["hidden before it is shown", { publishOn: "2026-09-21", hideAfter: "2026-09-20" }],
      ["a date that does not exist", { publishOn: "2026-02-30" }],
      ["a date in the wrong format", { publishOn: "21-09-2026" }],
      ["an unknown kind", { kind: "advert" as never }],
    ];
    const before = (await db.prepare("SELECT COUNT(*) AS n FROM content_items").first<{ n: number }>())!.n;
    for (const [label, over] of bad) {
      const result = await createContent(db, key, people.admin, notice(over));
      expect(result.ok, label).toBe(false);
      expect(result, label).toMatchObject({ reason: "invalid" });
    }
    expect((await db.prepare("SELECT COUNT(*) AS n FROM content_items").first<{ n: number }>())!.n).toBe(before);
  });

  it("accepts the edges: hide-after on the same day, 200-character title, a vacancy with a contact", async () => {
    expect((await createContent(db, key, people.admin, notice({ publishOn: "2026-09-21", hideAfter: "2026-09-21" }))).ok).toBe(true);
    expect((await createContent(db, key, people.admin, notice({ title: "x".repeat(200) }))).ok).toBe(true);
    expect((await createContent(db, key, people.admin, notice({ kind: "vacancy", contact: "9800000000" }))).ok).toBe(true);
  });

  it("keeps the words as typed apart from surrounding blanks, and treats markup as plain text", async () => {
    const id = await created({ title: "  <b>Bold</b> & more  ", body: "<script>alert(1)</script>\n\nSecond paragraph" });
    const row = await db.prepare("SELECT title, body FROM content_items WHERE public_id = ?1").bind(id).first<{ title: string; body: string }>();
    expect(row).toEqual({ title: "<b>Bold</b> & more", body: "<script>alert(1)</script>\n\nSecond paragraph" });
  });
});

// ---------------------------------------------------------------------------------------------
describe("publishing", () => {
  it("makes a draft live, records who and when, and is audited", async () => {
    const id = await created({ title: "Open day" });
    const result = await publishContent(db, key, people.admin, id, new Date("2026-09-21T06:00:00Z"));

    expect(result).toEqual({ ok: true });
    const row = await db.prepare("SELECT c.status, c.published_at, u.public_id AS by FROM content_items c JOIN users u ON u.id = c.published_by WHERE c.public_id = ?1").bind(id).first<{ status: string; published_at: string; by: string }>();
    expect(row).toEqual({ status: "live", published_at: "2026-09-21T06:00:00.000Z", by: people.admin });
    expect((await auditRows(id)).map((r) => r.action)).toEqual(["content.created", "content.published"]);
  });

  it("publishing what is already live says so, and adds no second entry", async () => {
    const id = await live();
    expect(await publishContent(db, key, people.admin, id)).toEqual({ ok: false, reason: "already_live" });
    expect((await auditRows(id)).filter((r) => r.action === "content.published")).toHaveLength(1);
  });

  it("two Admins publishing at the same moment: exactly one wins, and one entry is written", async () => {
    const id = await created();
    const results = await Promise.all([publishContent(db, key, people.admin, id), publishContent(db, key, people.admin2, id)]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, reason: "already_live" }]);
    expect((await auditRows(id)).filter((r) => r.action === "content.published")).toHaveLength(1);
    expect(await verifyAuditChain(db, key)).toMatchObject({ ok: true });
  });

  it("refuses everyone who is not an Admin, leaves the draft a draft, and writes no entry", async () => {
    const id = await created();
    for (const who of ["coordinator", "teacher", "student"] as const) {
      expect(await publishContent(db, key, people[who], id), who).toEqual({ ok: false, reason: "not_allowed" });
    }
    expect(await statusOf(id)).toBe("draft");
    expect((await auditRows(id)).map((r) => r.action)).toEqual(["content.created"]);
  });

  it("re-checks the person inside the write: an Admin switched off a moment ago cannot publish", async () => {
    const id = await created();
    const admin = await makeUser("admin");
    await db.prepare("UPDATE users SET is_active = 0 WHERE public_id = ?1").bind(admin).run();
    expect(await publishContent(db, key, admin, id)).toEqual({ ok: false, reason: "not_allowed" });
    expect(await statusOf(id)).toBe("draft");
  });

  it("an Admin switched off BETWEEN the check and the write is still refused: the write re-checks inside itself", async () => {
    const admin = await makeUser("admin");
    const id = await created();
    let switchedOff = false;
    const racing = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "prepare") return (sql: string) => target.prepare(sql);
        if (prop === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            const results = await target.batch(statements);
            if (!switchedOff) {
              // The first batch is the check. Right after it, the person is deactivated.
              switchedOff = true;
              await target.prepare("UPDATE users SET is_active = 0 WHERE public_id = ?1").bind(admin).run();
            }
            return results;
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as D1Database;

    expect(await publishContent(racing, key, admin, id)).toEqual({ ok: false, reason: "not_allowed" });
    expect(await statusOf(id)).toBe("draft");
    expect((await auditRows(id)).map((r) => r.action)).toEqual(["content.created"]);
  });

  it("says not found for an id that does not exist, and tells an outsider nothing about what does", async () => {
    expect(await publishContent(db, key, people.admin, "0".repeat(32))).toEqual({ ok: false, reason: "not_found" });
    expect(await publishContent(db, key, people.student, "0".repeat(32))).toEqual({ ok: false, reason: "not_allowed" });
  });

  it("taking it down returns it to a draft, is audited, and can be published again", async () => {
    const id = await live();
    expect(await unpublishContent(db, key, people.admin, id)).toEqual({ ok: true });
    expect(await statusOf(id)).toBe("draft");
    expect((await listPublicContent(db, "2099-01-01")).items.map((i) => i.id)).not.toContain(id);
    expect(await unpublishContent(db, key, people.admin, id)).toEqual({ ok: false, reason: "not_live" });
    expect(await publishContent(db, key, people.admin, id)).toEqual({ ok: true });
    expect((await auditRows(id)).map((r) => r.action)).toEqual(["content.created", "content.published", "content.unpublished", "content.published"]);
  });

  it("only an Admin may take it down", async () => {
    const id = await live();
    expect(await unpublishContent(db, key, people.coordinator, id)).toEqual({ ok: false, reason: "not_allowed" });
    expect(await statusOf(id)).toBe("live");
  });
});

// ---------------------------------------------------------------------------------------------
describe("editing", () => {
  it("changes only what was sent, keeps the kind, and audits before and after", async () => {
    const id = await created({ title: "Old", body: "Old body" });
    const result = await updateContent(db, key, people.admin, id, { title: "New" });

    expect(result).toEqual({ ok: true });
    const row = await db.prepare("SELECT kind, title, body FROM content_items WHERE public_id = ?1").bind(id).first();
    expect(row).toEqual({ kind: "notice", title: "New", body: "Old body" });
    const last = (await auditRows(id)).at(-1)!;
    expect(last.action).toBe("content.updated");
    expect(JSON.parse(last.before_json!)).toMatchObject({ title: "Old" });
    expect(JSON.parse(last.after_json!)).toMatchObject({ title: "New" });
  });

  it("editing live content is an Admin's act, and the change is public at once", async () => {
    const id = await live({ title: "Before" });
    expect(await updateContent(db, key, people.coordinator, id, { title: "Sneaky" })).toEqual({ ok: false, reason: "not_allowed" });
    expect(await updateContent(db, key, people.admin, id, { title: "After" })).toEqual({ ok: true });
    const item = (await listPublicContent(db, "2099-01-01")).items.find((i) => i.id === id);
    expect(item?.title).toBe("After");
  });

  it("can clear the hide-after date and the contact with null, and set them again", async () => {
    const id = await created({ kind: "vacancy", contact: "old@school.example", hideAfter: "2026-12-31" });
    expect(await updateContent(db, key, people.admin, id, { hideAfter: null })).toEqual({ ok: true });
    expect((await db.prepare("SELECT hide_after FROM content_items WHERE public_id = ?1").bind(id).first<{ hide_after: string | null }>())!.hide_after).toBeNull();
    expect(await updateContent(db, key, people.admin, id, { contact: "new@school.example" })).toEqual({ ok: true });
  });

  it("refuses a change that would break a rule as a whole, and changes nothing", async () => {
    const vacancy = await created({ kind: "vacancy", contact: "jobs@school.example" });
    const dated = await created({ publishOn: "2026-09-21", hideAfter: "2026-10-01" });

    expect(await updateContent(db, key, people.admin, vacancy, { contact: null })).toMatchObject({ ok: false, reason: "invalid" });
    expect(await updateContent(db, key, people.admin, dated, { publishOn: "2026-11-01" })).toMatchObject({ ok: false, reason: "invalid" });
    expect(await updateContent(db, key, people.admin, dated, { title: "" })).toMatchObject({ ok: false, reason: "invalid" });
    expect((await db.prepare("SELECT publish_on FROM content_items WHERE public_id = ?1").bind(dated).first<{ publish_on: string }>())!.publish_on).toBe("2026-09-21");
  });

  it("says not found, and never lets the kind or the status be changed through it", async () => {
    expect(await updateContent(db, key, people.admin, "0".repeat(32), { title: "x" })).toEqual({ ok: false, reason: "not_found" });
    const id = await created();
    await updateContent(db, key, people.admin, id, { kind: "post", status: "live" } as never);
    expect(await db.prepare("SELECT kind, status FROM content_items WHERE public_id = ?1").bind(id).first()).toEqual({ kind: "notice", status: "draft" });
  });

  it("the whole audit log is still one unbroken chain", async () => {
    expect(await verifyAuditChain(db, key)).toMatchObject({ ok: true });
  });
});

// ---------------------------------------------------------------------------------------------
describe("where an item stands (the Admin list)", () => {
  it("scheduled before its day, showing on both edge days, expired the day after: in the label and in the filter", async () => {
    const id = await live({ title: "States", publishOn: "2083-06-10", hideAfter: "2083-06-20" });
    const expectations: [string, string][] = [["2083-06-09", "scheduled"], ["2083-06-10", "showing"], ["2083-06-20", "showing"], ["2083-06-21", "expired"]];

    for (const [day, state] of expectations) {
      const all = (await listAdminContent(db, day)).items.find((i) => i.id === id);
      expect(all?.state, `${day} label`).toBe(state);
      const filtered = (await listAdminContent(db, day, { state: state as never })).items.map((i) => i.id);
      expect(filtered, `${day} filter`).toContain(id);
      for (const other of ["scheduled", "showing", "expired"].filter((s) => s !== state)) {
        expect((await listAdminContent(db, day, { state: other as never })).items.map((i) => i.id), `${day} not ${other}`).not.toContain(id);
      }
    }
  });

  it("a draft or an item waiting for approval keeps that word, whatever its dates", async () => {
    const draft = await created({ publishOn: "2020-01-01", hideAfter: "2020-01-02" });
    const waiting = await created({ publishOn: "2020-01-01" });
    await db.prepare("UPDATE content_items SET status = 'waiting' WHERE public_id = ?1").bind(waiting).run();
    const items = (await listAdminContent(db, "2099-01-01")).items;
    expect(items.find((i) => i.id === draft)?.state).toBe("draft");
    expect(items.find((i) => i.id === waiting)?.state).toBe("waiting");
  });

  it("reads in one round trip", async () => {
    let prepared = 0;
    const counting = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "prepare") return (sql: string) => { prepared++; return target.prepare(sql); };
        if (prop === "batch") return () => { throw new Error("unexpected batch"); };
        return Reflect.get(target, prop, receiver);
      },
    }) as D1Database;
    await listAdminContent(counting, TODAY);
    expect(prepared).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
describe("what the public sees", () => {
  it("only live items, from their publish day, until the end of their hide-after day", async () => {
    const id = await live({ title: "Window", publishOn: "2083-02-10", hideAfter: "2083-02-20" });
    const seen = async (day: string) => (await listPublicContent(db, day)).items.some((i) => i.id === id);

    expect(await seen("2083-02-09")).toBe(false);
    expect(await seen("2083-02-10")).toBe(true);
    expect(await seen("2083-02-20")).toBe(true);
    expect(await seen("2083-02-21")).toBe(false);
  });

  it("an item with no hide-after date stays", async () => {
    const id = await live({ publishOn: "2026-01-01", hideAfter: null });
    expect((await listPublicContent(db, "2099-12-31")).items.some((i) => i.id === id)).toBe(true);
  });

  it("drafts and items waiting for approval are never shown", async () => {
    const draft = await created({ title: "Draft only" });
    const waiting = await created({ title: "Waiting" });
    await db.prepare("UPDATE content_items SET status = 'waiting' WHERE public_id = ?1").bind(waiting).run();
    const ids = (await listPublicContent(db, "2099-12-31")).items.map((i) => i.id);
    expect(ids).not.toContain(draft);
    expect(ids).not.toContain(waiting);
  });

  it("the day changes at Nepal midnight (UTC+5:45), not UTC midnight", async () => {
    const id = await live({ title: "Nepal day", publishOn: "2083-03-05", hideAfter: "2083-03-05" });
    const at = async (iso: string) => (await listPublicContent(db, nepalDate(new Date(iso)))).items.some((i) => i.id === id);

    // 2083-03-05 (AD) in Nepal runs from 2083-03-04T18:15:00Z to 2083-03-05T18:14:59Z.
    expect(await at("2083-03-04T18:14:00Z")).toBe(false);
    expect(await at("2083-03-04T18:15:00Z")).toBe(true);
    expect(await at("2083-03-05T18:14:00Z")).toBe(true);
    expect(await at("2083-03-05T18:15:00Z")).toBe(false);
  });

  it("urgent first, then the newest publish day, and a stable order for ties", async () => {
    const tag = crypto.randomUUID().slice(0, 6);
    const older = await live({ title: `older ${tag}`, publishOn: "2083-04-01" });
    const newer = await live({ title: `newer ${tag}`, publishOn: "2083-04-05" });
    const urgentOld = await live({ title: `urgent ${tag}`, publishOn: "2083-03-20", urgent: true });
    const tieA = await live({ title: `tie a ${tag}`, publishOn: "2083-04-05" });

    const order = (await listPublicContent(db, "2083-05-01")).items.map((i) => i.id).filter((id) => [older, newer, urgentOld, tieA].includes(id));
    expect(order).toEqual([urgentOld, tieA, newer, older]);
  });

  it("can be narrowed to one kind", async () => {
    const post = await live({ kind: "post", title: "A post" });
    const only = (await listPublicContent(db, "2099-12-31", { kind: "post" })).items;
    expect(only.length).toBeGreaterThan(0);
    expect(only.every((i) => i.kind === "post")).toBe(true);
    expect(only.map((i) => i.id)).toContain(post);
  });

  it("shows exactly the public fields, and none of the internal ones", async () => {
    const id = await live({ kind: "vacancy", contact: "jobs@school.example", title: "Teacher wanted" });
    const item = (await listPublicContent(db, "2099-12-31")).items.find((i) => i.id === id)!;
    expect(Object.keys(item).sort()).toEqual(["body", "contact", "hideAfter", "id", "kind", "publishedOn", "title", "urgent"]);
    expect(item.id).toBe(id);
    expect(item.contact).toBe("jobs@school.example");
  });

  it("never returns more than 200 items in one answer", async () => {
    const result = await listPublicContent(db, "2099-12-31");
    expect(result.items.length).toBeLessThanOrEqual(200);
  });

  it("reads in one round trip", async () => {
    let prepared = 0;
    const counting = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "prepare") return (sql: string) => { prepared++; return target.prepare(sql); };
        if (prop === "batch") return () => { throw new Error("unexpected batch"); };
        return Reflect.get(target, prop, receiver);
      },
    }) as D1Database;
    await listPublicContent(counting, TODAY);
    expect(prepared).toBe(1);
  });
});
