import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { verifyAuditChain } from "../src/core/audit";
import { nepalMinute } from "../src/core/dates";
import { signAccessToken, type RoleClaim } from "../src/core/tokens";
import { createUser } from "../src/modules/accounts/service";
import { listAdminContent, listPublicContent, stateOf } from "../src/modules/content/queries";
import type { ContentInput } from "../src/modules/content/schema";
import { archiveContent, createContent, publishContent, unpublishContent, updateContent } from "../src/modules/content/service";

/**
 * The Website Content redesign (D-098): the Event and Information kinds, a time of day to start showing,
 * the Archived status, and the list's search, groups, paging, figures and author.
 */

const db = env.DB;
const key = env.AUDIT_HMAC_KEY;
const app = createApp();
const password = "blue-river-lamp-2083";

let n = 0;
async function person(role: string, scope: string, name = `${role} person`) {
  const email = `${role}-${++n}-${crypto.randomUUID().slice(0, 6)}@school.example`;
  const { publicId } = await createUser(db, key, { email, password, fullName: name, roles: [{ role: role as never, scope: scope as never }] });
  const now = Math.floor(Date.now() / 1000);
  const cookie = `__Host-access=${await signAccessToken(env.SESSION_SECRET, { sub: publicId, sid: "s", name, roles: [{ role, scope } as RoleClaim], iat: now, exp: now + 600 })}`;
  return { publicId, cookie };
}

const call = (path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) =>
  app.request(
    `https://school.example${path}`,
    {
      method: init.method ?? "GET",
      headers: {
        "Sec-Fetch-Site": "same-origin",
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(init.cookie ? { Cookie: init.cookie } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    },
    env,
  );

const people = {} as Record<"admin" | "support" | "coordinator" | "teacher" | "accountant", Awaited<ReturnType<typeof person>>>;
beforeAll(async () => {
  people.admin = await person("admin", "institution", "Sita Principal");
  people.support = await person("super_admin", "institution", "Build Team Member");
  people.coordinator = await person("coordinator", "institution", "Hari Coordinator");
  people.teacher = await person("teacher", "assigned");
  people.accountant = await person("accountant", "institution");
});

const item = (over: Partial<ContentInput> = {}): ContentInput => ({
  kind: "notice",
  title: "A notice",
  body: "Some text.",
  contact: null,
  urgent: false,
  publishOn: "2026-10-01",
  hideAfter: null,
  ...over,
});

async function created(over: Partial<ContentInput> = {}, actor = people.admin.publicId) {
  const result = await createContent(db, key, actor, item(over));
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result)}`);
  return result.publicId;
}
async function published(over: Partial<ContentInput> = {}, now = new Date("2026-10-01T06:00:00Z")) {
  const id = await created(over);
  const result = await publishContent(db, key, people.admin.publicId, id, now);
  if (!result.ok) throw new Error(`publish failed: ${result.reason}`);
  return id;
}
const row = async (id: string) =>
  (await db.prepare("SELECT status, publish_time, archived_at, archived_by FROM content_items WHERE public_id = ?1").bind(id).first<{ status: string; publish_time: string; archived_at: string | null; archived_by: number | null }>())!;
const actions = async (id: string) => (await db.prepare("SELECT action FROM audit_events WHERE entity_public_id = ?1 ORDER BY id").bind(id).all<{ action: string }>()).results.map((r) => r.action);
const isPublic = async (id: string, at: string) => (await listPublicContent(db, at)).items.some((i) => i.id === id);

// ---------------------------------------------------------------------------------------------
describe("Event and Information (D-098)", () => {
  it("both can be written, published and filtered on, like any other kind", async () => {
    const event = await published({ kind: "event", title: "Parent-Teacher Meeting" });
    const info = await published({ kind: "information", title: "Library hours" });
    expect((await listPublicContent(db, "2026-10-01", { kind: "event" })).items.map((i) => i.id)).toEqual([event]);
    expect((await listPublicContent(db, "2026-10-01", { kind: "information" })).items.map((i) => i.id)).toEqual([info]);
    expect((await listAdminContent(db, "2026-10-01", { kind: "event" })).items.every((i) => i.kind === "event")).toBe(true);
  });

  it("are plain posts: no holiday dates and no contact", async () => {
    expect(await createContent(db, key, people.admin.publicId, item({ kind: "event", holidayFrom: "2026-10-02" }))).toMatchObject({ ok: false, reason: "invalid" });
    expect(await createContent(db, key, people.admin.publicId, item({ kind: "information", contact: "a@b.example" }))).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("the database refuses a kind it does not know", async () => {
    await expect(
      db.prepare("INSERT INTO content_items (public_id, kind, title, body, publish_on, created_by, created_at, updated_at) SELECT 'x1', 'gallery', 't', 'b', '2026-10-01', id, 'now', 'now' FROM users LIMIT 1").run(),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------------------------
describe("a time of day to start showing (D-098)", () => {
  it("is midnight when not given, so an item shows from the start of its day as before", async () => {
    const id = await created();
    expect((await row(id)).publish_time).toBe("00:00");
  });

  it("shows from that minute by Nepal's clock, and not a minute before", async () => {
    const id = await published({ publishOn: "2026-10-05", publishTime: "10:00" });
    expect(await isPublic(id, "2026-10-05 09:59")).toBe(false);
    expect(await isPublic(id, "2026-10-05 10:00")).toBe(true);
    expect(await isPublic(id, "2026-10-04")).toBe(false); // a bare day means the end of that day
    expect(await isPublic(id, "2026-10-05")).toBe(true);
  });

  it("publishing says whether it shows now or is scheduled, by the clock at the moment of publishing", async () => {
    const later = await created({ publishOn: "2026-10-05", publishTime: "08:00" });
    // 2026-10-05 02:00 UTC is 07:45 in Nepal: fifteen minutes early.
    expect(await publishContent(db, key, people.admin.publicId, later, new Date("2026-10-05T02:00:00Z"))).toEqual({ ok: true, state: "scheduled" });
    const now = await created({ publishOn: "2026-10-05", publishTime: "07:45" });
    expect(await publishContent(db, key, people.admin.publicId, now, new Date("2026-10-05T02:00:00Z"))).toEqual({ ok: true, state: "showing" });
  });

  it("the state agrees with the public list on the edge minute", async () => {
    expect(stateOf("live", "2026-10-05", "10:00", null, "2026-10-05 09:59")).toBe("scheduled");
    expect(stateOf("live", "2026-10-05", "10:00", null, "2026-10-05 10:00")).toBe("showing");
    expect(stateOf("live", "2026-10-05", "10:00", "2026-10-05", "2026-10-06 00:00")).toBe("expired");
  });

  it("is checked: a time that is not HH:MM is refused, by the service and by the database", async () => {
    for (const publishTime of ["24:00", "9:00", "10:60", "10:00:00", "noon"]) {
      expect(await createContent(db, key, people.admin.publicId, item({ publishTime })), publishTime).toMatchObject({ ok: false, reason: "invalid" });
    }
    const id = await created();
    await expect(db.prepare("UPDATE content_items SET publish_time = '24:00' WHERE public_id = ?1").bind(id).run()).rejects.toThrow();
  });

  it("an edit can move it, and the edit is audited", async () => {
    const id = await created();
    expect(await updateContent(db, key, people.admin.publicId, id, { publishTime: "15:30" })).toEqual({ ok: true });
    expect((await row(id)).publish_time).toBe("15:30");
    expect(await actions(id)).toEqual(["content.created", "content.updated"]);
  });

  it("Nepal time is UTC+5:45", () => {
    expect(nepalMinute(new Date("2026-10-04T18:15:00Z"))).toBe("2026-10-05 00:00");
    expect(nepalMinute(new Date("2026-10-04T18:14:00Z"))).toBe("2026-10-04 23:59");
  });
});

// ---------------------------------------------------------------------------------------------
describe("archiving (D-098)", () => {
  it("takes a live item off the website at once, keeps it, records who and when, and is audited", async () => {
    const id = await published({ title: "Old notice" });
    expect(await isPublic(id, "2026-10-01")).toBe(true);
    expect(await archiveContent(db, key, people.admin.publicId, id, new Date("2026-10-01T07:00:00Z"))).toEqual({ ok: true });

    const r = await row(id);
    expect(r.status).toBe("archived");
    expect(r.archived_at).toBe("2026-10-01T07:00:00.000Z");
    expect(r.archived_by).not.toBeNull();
    expect(await isPublic(id, "2026-10-01")).toBe(false);
    expect(await actions(id)).toEqual(["content.created", "content.published", "content.archived"]);
    expect((await listAdminContent(db, "2026-10-01", { group: "archived" })).items.find((i) => i.id === id)?.state).toBe("archived");
  });

  it("a draft can be archived too; a second click changes nothing", async () => {
    const id = await created();
    expect(await archiveContent(db, key, people.admin.publicId, id)).toEqual({ ok: true });
    expect(await archiveContent(db, key, people.admin.publicId, id)).toEqual({ ok: false, reason: "already_archived" });
    expect(await actions(id)).toEqual(["content.created", "content.archived"]);
  });

  it("an item waiting for approval is the approval's to settle first", async () => {
    const id = await created({}, people.coordinator.publicId);
    await db.prepare("UPDATE content_items SET status = 'waiting' WHERE public_id = ?1").bind(id).run();
    expect(await archiveContent(db, key, people.admin.publicId, id)).toEqual({ ok: false, reason: "waiting" });
    expect((await row(id)).status).toBe("waiting");
  });

  it("only a publisher may archive; a Co-ordinator may not, nor edit what is archived", async () => {
    const id = await published();
    expect(await archiveContent(db, key, people.coordinator.publicId, id)).toEqual({ ok: false, reason: "not_allowed" });
    expect(await archiveContent(db, key, people.teacher.publicId, id)).toEqual({ ok: false, reason: "not_allowed" });
    expect(await archiveContent(db, key, people.support.publicId, id)).toEqual({ ok: true });
    expect(await updateContent(db, key, people.coordinator.publicId, id, { title: "Sneaky" })).toEqual({ ok: false, reason: "not_allowed" });
  });

  it("cannot be published straight from the archive; Move to drafts brings it back, and then it can", async () => {
    const id = await published();
    await archiveContent(db, key, people.admin.publicId, id);
    expect(await publishContent(db, key, people.admin.publicId, id)).toEqual({ ok: false, reason: "archived" });

    expect(await unpublishContent(db, key, people.admin.publicId, id)).toEqual({ ok: true });
    expect(await row(id)).toMatchObject({ status: "draft", archived_at: null, archived_by: null });
    expect((await publishContent(db, key, people.admin.publicId, id, new Date("2026-10-01T06:00:00Z"))).ok).toBe(true);
    expect(await actions(id)).toEqual(["content.created", "content.published", "content.archived", "content.unpublished", "content.published"]);
  });

  it("the database keeps the archive stamp and the status together", async () => {
    const id = await created();
    await expect(db.prepare("UPDATE content_items SET status = 'archived' WHERE public_id = ?1").bind(id).run()).rejects.toThrow();
  });

  it("leaves the audit chain whole", async () => {
    expect((await verifyAuditChain(db, key)).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
describe("the Admin list: search, groups, paging, figures and author (D-098)", () => {
  const AT = "2030-03-10 12:00";
  const stamp = "zq" + crypto.randomUUID().slice(0, 6); // a word only this block's items carry

  it("finds words in the title, the text or the author's name, and treats % and _ as plain characters", async () => {
    const inTitle = await created({ title: `Exam ${stamp} schedule` });
    const inBody = await created({ body: `Bring your ${stamp} card.` });
    const byCoordinator = await created({ title: "Sports day" }, people.coordinator.publicId);
    await created({ title: "100% attendance" });

    const found = async (q: string) => (await listAdminContent(db, AT, { q, pageSize: 50 })).items.map((i) => i.id);
    expect((await found(stamp)).sort()).toEqual([inTitle, inBody].sort());
    expect(await found("Hari Coordinator")).toContain(byCoordinator);
    // "%" and "_" are not wildcards here: each finds only text that really has one.
    const withPercent = (await listAdminContent(db, AT, { q: "%", pageSize: 50 })).items;
    expect(withPercent.length).toBeGreaterThan(0);
    expect(withPercent.every((i) => i.title.includes("%"))).toBe(true);
    expect(await found("_")).toEqual([]);
  });

  it("groups: published, drafts (with waiting), scheduled, and archived (with expired)", async () => {
    const stamp = "gr" + crypto.randomUUID().slice(0, 6);
    const showing = await published({ title: `${stamp} showing`, publishOn: "2030-03-01" });
    const scheduled = await published({ title: `${stamp} scheduled`, publishOn: "2030-03-10", publishTime: "18:00" });
    const expired = await published({ title: `${stamp} expired`, publishOn: "2030-03-01", hideAfter: "2030-03-05" });
    const draft = await created({ title: `${stamp} draft` });
    const waiting = await created({ title: `${stamp} waiting` }, people.coordinator.publicId);
    await db.prepare("UPDATE content_items SET status = 'waiting' WHERE public_id = ?1").bind(waiting).run();
    const archived = await created({ title: `${stamp} archived` });
    await archiveContent(db, key, people.admin.publicId, archived);

    const group = async (g: "published" | "draft" | "scheduled" | "archived") =>
      (await listAdminContent(db, AT, { group: g, q: stamp, pageSize: 50 })).items.map((i) => i.id).sort();
    expect(await group("published")).toEqual([showing]);
    expect(await group("scheduled")).toEqual([scheduled]);
    expect(await group("draft")).toEqual([draft, waiting].sort());
    expect(await group("archived")).toEqual([archived, expired].sort());
  });

  it("type, group and urgency combine", async () => {
    const holiday = await published({ kind: "holiday", title: `${stamp} Dashain`, publishOn: "2030-03-10", publishTime: "20:00", holidayFrom: "2030-03-20", urgent: true });
    await published({ kind: "notice", title: `${stamp} other`, publishOn: "2030-03-10", publishTime: "20:00" });
    const ids = (await listAdminContent(db, AT, { kind: "holiday", group: "scheduled", urgent: true, q: stamp })).items.map((i) => i.id);
    expect(ids).toEqual([holiday]);
  });

  it("pages in the database, newest touched first, and says how many match in all", async () => {
    const word = "pg" + crypto.randomUUID().slice(0, 6);
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) ids.push(await created({ title: `${word} ${i}` }, people.admin.publicId));
    // Touch them in order so "most recently touched" is the reverse of creation.
    for (const [i, id] of ids.entries()) await db.prepare("UPDATE content_items SET updated_at = ?2 WHERE public_id = ?1").bind(id, `2030-01-01T00:00:0${i}Z`).run();

    const first = await listAdminContent(db, AT, { q: word, pageSize: 3 });
    const third = await listAdminContent(db, AT, { q: word, pageSize: 3, page: 3 });
    expect(first).toMatchObject({ total: 7, page: 1, pageSize: 3 });
    expect(first.items.map((i) => i.id)).toEqual([ids[6], ids[5], ids[4]]);
    expect(third.items.map((i) => i.id)).toEqual([ids[0]]);
    expect((await listAdminContent(db, AT, { q: word, pageSize: 3, page: 9 })).items).toEqual([]);
    expect((await listAdminContent(db, AT, { pageSize: 500 })).pageSize).toBe(50);
  });

  it("the four figures count everything, whatever the filters: on the website, not visible, scheduled, and urgent", async () => {
    const before = (await listAdminContent(db, AT)).counts;
    await published({ publishOn: "2030-03-01" }); // showing
    await published({ publishOn: "2030-03-01", urgent: true }); // showing, urgent
    await published({ publishOn: "2030-04-01", urgent: true }); // scheduled, urgent
    await created({ urgent: true }); // a draft: urgent, but not counted as urgent until it is published
    await published({ publishOn: "2030-03-01", hideAfter: "2030-03-02", urgent: true }); // expired: counted nowhere
    const after = (await listAdminContent(db, AT, { kind: "vacancy", q: "nothing matches this" })).counts;
    expect({
      published: after.published - before.published,
      drafts: after.drafts - before.drafts,
      scheduled: after.scheduled - before.scheduled,
      urgent: after.urgent - before.urgent,
    }).toEqual({ published: 2, drafts: 1, scheduled: 1, urgent: 2 });
  });

  it("names the author, but shows the build team only as Support (null)", async () => {
    const mine = await created({ title: `${stamp} by admin` });
    const theirs = await created({ title: `${stamp} by support` }, people.support.publicId);
    const items = (await listAdminContent(db, AT, { q: stamp, pageSize: 50 })).items;
    expect(items.find((i) => i.id === mine)?.authorName).toBe("Sita Principal");
    expect(items.find((i) => i.id === theirs)?.authorName).toBeNull();
    expect(await listAdminContent(db, AT, { q: "Build Team Member" })).toMatchObject({ total: 0 }); // nor found by their name
  });
});

// ---------------------------------------------------------------------------------------------
describe("the routes (D-098)", () => {
  it("the list answers with a page, the total, the figures, the website and the time now", async () => {
    const response = await call("/api/content?group=draft&q=a&page=1&pageSize=5&urgent=false", { cookie: people.admin.cookie });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["counts", "items", "nowTime", "page", "pageSize", "site", "todayBs", "total"]);
    expect(body.pageSize).toBe(5);
    expect(body.nowTime).toMatch(/^\d{2}:\d{2}$/);
    expect(body.site).toEqual({ address: env.SITE_ORIGIN ?? null, live: false, lastPublishedAt: expect.anything() });
  });

  it("refuses filters that make no sense", async () => {
    for (const query of ["group=gone", "urgent=yes", "page=0", "pageSize=51", `q=${"x".repeat(101)}`, "kind=gallery"]) {
      expect((await call(`/api/content?${query}`, { cookie: people.admin.cookie })).status, query).toBe(400);
    }
  });

  it("a Co-ordinator can read the list; a teacher or an Accountant cannot", async () => {
    expect((await call("/api/content", { cookie: people.coordinator.cookie })).status).toBe(200);
    expect((await call("/api/content", { cookie: people.teacher.cookie })).status).toBe(403);
    expect((await call("/api/content", { cookie: people.accountant.cookie })).status).toBe(403);
  });

  it("archive: Admin and Support only, 409 on a repeat, 404 for no such item, 401 signed out", async () => {
    const id = await published();
    const archive = (cookie?: string, target = id) => call(`/api/content/${target}/archive`, { method: "POST", ...(cookie && { cookie }) });
    expect((await archive()).status).toBe(401);
    for (const who of [people.coordinator, people.teacher, people.accountant]) expect((await archive(who.cookie)).status).toBe(403);
    expect((await archive(people.admin.cookie)).status).toBe(200);
    expect(await (await archive(people.admin.cookie)).json()).toEqual({ error: "already_archived" });
    expect((await archive(people.admin.cookie, "0".repeat(32))).status).toBe(404);
  });

  it("publish answers with the state; publishing an archived item is 409", async () => {
    const id = (await (await call("/api/content", { method: "POST", cookie: people.admin.cookie, body: { kind: "event", title: "Far", body: "x", publishOn: "2083-01-01", publishTime: "09:00" } })).json()) as { id: string };
    const response = await call(`/api/content/${id.id}/publish`, { method: "POST", cookie: people.admin.cookie });
    expect(await response.json()).toEqual({ ok: true, state: "scheduled" });
    await call(`/api/content/${id.id}/archive`, { method: "POST", cookie: people.admin.cookie });
    const again = await call(`/api/content/${id.id}/publish`, { method: "POST", cookie: people.admin.cookie });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "archived" });
  });
});
