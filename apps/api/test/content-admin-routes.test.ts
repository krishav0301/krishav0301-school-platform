import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { verifyAuditChain } from "../src/core/audit";
import { adToBsText, nepalDate } from "../src/core/dates";
import { signAccessToken, type RoleClaim } from "../src/core/tokens";
import { createUser } from "../src/modules/accounts/service";

const db = env.DB;
const key = env.AUDIT_HMAC_KEY;
const app = createApp();
const password = "blue-river-lamp-2083";

const call = (path: string, init: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) =>
  app.request(
    `https://school.example${path}`,
    {
      method: init.method ?? "GET",
      headers: {
        "Sec-Fetch-Site": "same-origin",
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(init.cookie ? { Cookie: init.cookie } : {}),
        ...init.headers,
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    },
    env,
  );

async function cookieFor(publicId: string, roles: RoleClaim[]) {
  const now = Math.floor(Date.now() / 1000);
  return `__Host-access=${await signAccessToken(env.SESSION_SECRET, { sub: publicId, sid: "s", name: "Person", roles, iat: now, exp: now + 600 })}`;
}

let n = 0;
async function person(role: string, scope: string, section?: string) {
  const email = `${role}-${++n}-${crypto.randomUUID().slice(0, 6)}@school.example`;
  const { publicId } = await createUser(db, key, { email, password, fullName: `${role} person`, roles: [{ role: role as never, scope: scope as never, ...(section ? { sectionKey: section } : {}) }] });
  return { publicId, cookie: await cookieFor(publicId, [{ role, scope, ...(section ? { section } : {}) } as RoleClaim]) };
}

const today = () => nepalDate(new Date());
const draft = (over: Record<string, unknown> = {}) => ({ kind: "notice", title: "Winter break", body: "Closed on Friday.", publishOn: "2026-09-21", ...over });

const contentCount = async () => (await db.prepare("SELECT COUNT(*) AS n FROM content_items").first<{ n: number }>())!.n;
const auditFor = async (id: string) =>
  (await db.prepare("SELECT a.action, u.public_id AS actor FROM audit_events a LEFT JOIN users u ON u.id = a.actor_user_id WHERE a.entity_public_id = ?1 ORDER BY a.id").bind(id).all<{ action: string; actor: string }>()).results;

type Item = { id: string; kind: string; title: string; body: string; contact: string | null; urgent: boolean; status: string; state: string; publishOn: string; hideAfter: string | null; createdAt: string; updatedAt: string; publishedAt: string | null };
const detail = async (id: string, cookie = admin.cookie) => (await (await call(`/api/content/${id}`, { cookie })).json()) as Item;
const list = async (cookie: string, query = "") => (await (await call(`/api/content${query}`, { cookie })).json()) as { items: Item[] };

let admin: Awaited<ReturnType<typeof person>>;
let superAdmin: Awaited<ReturnType<typeof person>>;
let coordinator: Awaited<ReturnType<typeof person>>;
let outsiders: [string, Awaited<ReturnType<typeof person>>][];

beforeAll(async () => {
  admin = await person("admin", "institution");
  superAdmin = await person("super_admin", "institution");
  coordinator = await person("coordinator", "institution");
  outsiders = [
    ["student", await person("student", "own")],
    ["teacher", await person("teacher", "assigned")],
    ["accountant", await person("accountant", "institution")],
  ];
});

async function newDraft(over: Record<string, unknown> = {}) {
  const response = await call("/api/content", { method: "POST", cookie: admin.cookie, body: draft(over) });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

// ---------------------------------------------------------------------------------------------
describe("who may use the content routes", () => {
  const id = "0".repeat(32);
  const draftRoutes: [string, string, unknown][] = [
    ["GET", "/api/content", undefined],
    ["GET", `/api/content/${id}`, undefined],
    ["POST", "/api/content", draft()],
    ["PATCH", `/api/content/${id}`, { title: "x" }],
  ];
  const publishRoutes: [string, string, unknown][] = [
    ["POST", `/api/content/${id}/publish`, undefined],
    ["POST", `/api/content/${id}/unpublish`, undefined],
  ];
  const routes = [...draftRoutes, ...publishRoutes];

  it("nobody who is signed out: 401, and a garbage body is not even looked at", async () => {
    for (const [method, path, body] of routes) {
      expect((await call(path, { method, body })).status, `${method} ${path}`).toBe(401);
    }
    expect((await call("/api/content", { method: "POST", body: { nonsense: true } })).status).toBe(401);
  });

  it("a forged or expired sign-in is 401 too", async () => {
    expect((await call("/api/content", { cookie: "__Host-access=forged" })).status).toBe(401);
  });

  it("a student, a teacher and an accountant: 403 everywhere, the handler never runs, nothing is written", async () => {
    const before = await contentCount();
    for (const [role, who] of outsiders) {
      for (const [method, path, body] of routes) {
        expect((await call(path, { method, body, cookie: who.cookie })).status, `${role} ${method} ${path}`).toBe(403);
      }
    }
    expect(await contentCount()).toBe(before);
  });

  it("the Admin and the Super Admin may do all of it", async () => {
    for (const who of [admin, superAdmin]) {
      expect((await call("/api/content", { cookie: who.cookie })).status).toBe(200);
      expect((await call("/api/content", { method: "POST", cookie: who.cookie, body: draft() })).status).toBe(201);
    }
  });

  it("a Co-ordinator may read, draft and edit (D-061), but not publish or take down", async () => {
    for (const [method, path, body] of draftRoutes.slice(0, 2)) expect((await call(path, { method, body, cookie: coordinator.cookie })).status, `${method} ${path}`).not.toBe(403);
    expect((await call("/api/content", { method: "POST", cookie: coordinator.cookie, body: draft() })).status).toBe(201);
    for (const [method, path, body] of publishRoutes) expect((await call(path, { method, body, cookie: coordinator.cookie })).status, `${method} ${path}`).toBe(403);
  });

  it("a Co-ordinator may edit their own draft, but not a live item once the Admin has published it", async () => {
    const id2 = await newDraft({ title: "Coordinator's own" });
    expect((await call(`/api/content/${id2}`, { method: "PATCH", cookie: coordinator.cookie, body: { title: "Edited by Co-ordinator" } })).status).toBe(200);
    await call(`/api/content/${id2}/publish`, { method: "POST", cookie: admin.cookie });
    expect((await call(`/api/content/${id2}`, { method: "PATCH", cookie: coordinator.cookie, body: { title: "Sneaky" } })).status).toBe(403);
  });

  it("a write from another site is refused before anything else", async () => {
    const response = await call("/api/content", { method: "POST", cookie: admin.cookie, body: draft(), headers: { "Sec-Fetch-Site": "cross-site" } });
    expect(response.status).toBe(403);
  });

  it("a valid sign-in for someone who has since been switched off is refused by the write itself", async () => {
    const gone = await person("admin", "institution");
    const id2 = await newDraft();
    await db.prepare("UPDATE users SET is_active = 0 WHERE public_id = ?1").bind(gone.publicId).run();
    const before = await contentCount();

    expect((await call("/api/content", { method: "POST", cookie: gone.cookie, body: draft() })).status).toBe(403);
    expect((await call(`/api/content/${id2}/publish`, { method: "POST", cookie: gone.cookie })).status).toBe(403);
    expect((await call(`/api/content/${id2}`, { method: "PATCH", cookie: gone.cookie, body: { title: "Sneaky" } })).status).toBe(403);
    expect(await contentCount()).toBe(before);
  });
});

// ---------------------------------------------------------------------------------------------
describe("POST /api/content", () => {
  it("saves a draft, names the person from the sign-in, and it is not public", async () => {
    const response = await call("/api/content", { method: "POST", cookie: admin.cookie, body: draft({ title: "Fee reminder" }) });
    const { id } = (await response.json()) as { id: string };

    expect(response.status).toBe(201);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    const item = await detail(id);
    expect(item).toMatchObject({ title: "Fee reminder", status: "draft", state: "draft", contact: null, urgent: false, hideAfter: null, publishedAt: null });
    expect((await list(admin.cookie)).items.map((i) => i.id)).toContain(id);
    expect(((await (await call("/api/site/content")).json()) as { items: { id: string }[] }).items.map((i) => i.id)).not.toContain(id);
    expect(await auditFor(id)).toEqual([{ action: "content.created", actor: admin.publicId }]);
  });

  it("refuses bad content with 400, and writes nothing", async () => {
    const before = await contentCount();
    const bad: [string, unknown][] = [
      ["no title", draft({ title: "" })],
      ["a title of blanks", draft({ title: "    " })],
      ["missing body", { kind: "notice", title: "T", publishOn: "2026-09-21" }],
      ["unknown kind", draft({ kind: "advert" })],
      ["a vacancy with no contact", draft({ kind: "vacancy" })],
      ["a contact on a notice", draft({ contact: "help@school.example" })],
      ["hidden before shown", draft({ hideAfter: "2026-09-01" })],
      ["a day that does not exist", draft({ publishOn: "2026-02-30" })],
      ["a day in the wrong form", draft({ publishOn: "21/09/2026" })],
      ["a status smuggled in", draft({ status: "live" })],
      ["not an object", "hello"],
    ];
    for (const [label, body] of bad) {
      expect((await call("/api/content", { method: "POST", cookie: admin.cookie, body })).status, label).toBe(400);
    }
    expect(await contentCount()).toBe(before);
  });

  it("takes the optional parts as they come: a vacancy with a contact, urgent, and a hide-after day", async () => {
    const id = await newDraft({ kind: "vacancy", contact: "9800000000", urgent: true, hideAfter: "2026-12-31" });
    const item = await detail(id);
    expect(item).toMatchObject({ kind: "vacancy", contact: "9800000000", urgent: true, hideAfter: "2026-12-31" });
  });
});

// ---------------------------------------------------------------------------------------------
describe("PATCH /api/content/{id}", () => {
  it("changes only what was sent, and says nothing else changed", async () => {
    const id = await newDraft({ title: "Old", body: "Old body" });
    const response = await call(`/api/content/${id}`, { method: "PATCH", cookie: admin.cookie, body: { title: "New" } });

    expect(response.status).toBe(200);
    const item = await detail(id);
    expect(item).toMatchObject({ title: "New", body: "Old body" });
    expect((await auditFor(id)).map((a) => a.action)).toEqual(["content.created", "content.updated"]);
  });

  it("a live item edited is public straight away", async () => {
    const id = await newDraft({ publishOn: "2020-01-01" });
    await call(`/api/content/${id}/publish`, { method: "POST", cookie: admin.cookie });
    await call(`/api/content/${id}`, { method: "PATCH", cookie: admin.cookie, body: { title: "Edited live" } });
    const item = ((await (await call("/api/site/content")).json()) as { items: { id: string; title: string }[] }).items.find((i) => i.id === id);
    expect(item?.title).toBe("Edited live");
  });

  it("an empty change is fine and writes no entry", async () => {
    const id = await newDraft();
    expect((await call(`/api/content/${id}`, { method: "PATCH", cookie: admin.cookie, body: {} })).status).toBe(200);
    expect((await auditFor(id)).map((a) => a.action)).toEqual(["content.created"]);
  });

  it("refuses fields that may not change (the kind, the status), with 400", async () => {
    const id = await newDraft();
    for (const body of [{ kind: "post" }, { status: "live" }, { id: "x" }]) {
      expect((await call(`/api/content/${id}`, { method: "PATCH", cookie: admin.cookie, body })).status, JSON.stringify(body)).toBe(400);
    }
    expect(await detail(id)).toMatchObject({ kind: "notice", status: "draft" });
  });

  it("refuses a change that breaks a rule as a whole with 422 and a message, and changes nothing", async () => {
    const vacancy = await newDraft({ kind: "vacancy", contact: "jobs@school.example" });
    const dated = await newDraft({ publishOn: "2026-09-21", hideAfter: "2026-10-01" });

    const noContact = await call(`/api/content/${vacancy}`, { method: "PATCH", cookie: admin.cookie, body: { contact: null } });
    expect(noContact.status).toBe(422);
    expect(await noContact.json()).toEqual({ error: "invalid", message: expect.stringContaining("contact") });
    expect((await call(`/api/content/${dated}`, { method: "PATCH", cookie: admin.cookie, body: { publishOn: "2026-11-01" } })).status).toBe(422);
    expect((await detail(dated)).publishOn).toBe("2026-09-21");
  });

  it("404 for an item that does not exist, 400 for an id that cannot be one", async () => {
    expect((await call(`/api/content/${"f".repeat(32)}`, { method: "PATCH", cookie: admin.cookie, body: { title: "x" } })).status).toBe(404);
    expect((await call("/api/content/not-an-id", { method: "PATCH", cookie: admin.cookie, body: { title: "x" } })).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------------------------
describe("publishing and taking down", () => {
  it("publish puts it on the public site, and says who and when", async () => {
    const id = await newDraft({ title: "Open day", publishOn: "2020-01-01" });
    const response = await call(`/api/content/${id}/publish`, { method: "POST", cookie: admin.cookie });

    expect(response.status).toBe(200);
    const item = (await list(admin.cookie)).items.find((i) => i.id === id)!;
    expect(item).toMatchObject({ status: "live", state: "showing" });
    expect(item.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(((await (await call("/api/site/content")).json()) as { items: { id: string }[] }).items.map((i) => i.id)).toContain(id);
    expect(await auditFor(id)).toEqual([
      { action: "content.created", actor: admin.publicId },
      { action: "content.published", actor: admin.publicId },
    ]);
  });

  it("publishing again is 409 already_live, with no second entry", async () => {
    const id = await newDraft();
    await call(`/api/content/${id}/publish`, { method: "POST", cookie: admin.cookie });
    const again = await call(`/api/content/${id}/publish`, { method: "POST", cookie: admin.cookie });

    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "already_live" });
    expect((await auditFor(id)).filter((a) => a.action === "content.published")).toHaveLength(1);
  });

  it("two Admins pressing Publish together: one 200, one 409", async () => {
    const other = await person("admin", "institution");
    const id = await newDraft();
    const responses = await Promise.all([
      call(`/api/content/${id}/publish`, { method: "POST", cookie: admin.cookie }),
      call(`/api/content/${id}/publish`, { method: "POST", cookie: other.cookie }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await auditFor(id)).filter((a) => a.action === "content.published")).toHaveLength(1);
  });

  it("take down returns it to a draft; taking down a draft is 409 not_live", async () => {
    const id = await newDraft({ publishOn: "2020-01-01" });
    await call(`/api/content/${id}/publish`, { method: "POST", cookie: admin.cookie });

    expect((await call(`/api/content/${id}/unpublish`, { method: "POST", cookie: admin.cookie })).status).toBe(200);
    expect((await list(admin.cookie)).items.find((i) => i.id === id)!.status).toBe("draft");
    expect(((await (await call("/api/site/content")).json()) as { items: { id: string }[] }).items.map((i) => i.id)).not.toContain(id);

    const again = await call(`/api/content/${id}/unpublish`, { method: "POST", cookie: admin.cookie });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "not_live" });
  });

  it("404 for an item that does not exist", async () => {
    for (const verb of ["publish", "unpublish"]) {
      expect((await call(`/api/content/${"e".repeat(32)}/${verb}`, { method: "POST", cookie: admin.cookie })).status, verb).toBe(404);
    }
  });

  it("the audit log is still one unbroken chain", async () => {
    expect(await verifyAuditChain(db, key)).toMatchObject({ ok: true });
  });
});

// ---------------------------------------------------------------------------------------------
describe("GET /api/content", () => {
  it("shows every item in every state, with a plain state for the screen, and is never cached", async () => {
    const tag = crypto.randomUUID().slice(0, 6);
    const drafted = await newDraft({ title: `draft ${tag}` });
    const showing = await newDraft({ title: `showing ${tag}`, publishOn: "2020-01-01" });
    const scheduled = await newDraft({ title: `scheduled ${tag}`, publishOn: "2999-01-01" });
    const expired = await newDraft({ title: `expired ${tag}`, publishOn: "2020-01-01", hideAfter: "2020-01-02" });
    for (const id of [showing, scheduled, expired]) await call(`/api/content/${id}/publish`, { method: "POST", cookie: admin.cookie });

    const response = await call("/api/content", { cookie: admin.cookie });
    const items = ((await response.json()) as { items: Item[] }).items;
    const stateOf = (id: string) => items.find((i) => i.id === id)?.state;

    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect([stateOf(drafted), stateOf(showing), stateOf(scheduled), stateOf(expired)]).toEqual(["draft", "showing", "scheduled", "expired"]);
    expect(today() > "2020-01-02").toBe(true);
  });

  it("gives every day in Bikram Sambat too (null beyond the verified years), and today in Bikram Sambat", async () => {
    const far = await newDraft({ title: "Far away", publishOn: "2999-01-01" });
    const near = await newDraft({ title: "Near", publishOn: "2020-01-01", hideAfter: "2020-02-01" });
    const response = (await (await call("/api/content", { cookie: admin.cookie })).json()) as { items: Item[] & { publishOnBs: string | null; hideAfterBs: string | null }[]; todayBs: string | null };
    const byId = (id: string) => response.items.find((i) => i.id === id) as unknown as { publishOnBs: string | null; hideAfterBs: string | null };

    expect(byId(near).publishOnBs).toBe(adToBsText("2020-01-01"));
    expect(byId(near).hideAfterBs).toBe(adToBsText("2020-02-01"));
    expect(byId(far).publishOnBs).toBeNull();
    expect(response.todayBs).toBe(adToBsText(today()));
    expect(response.todayBs).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("narrows by kind and by state, and refuses a filter that does not exist", async () => {
    await newDraft({ kind: "post", title: "A post" });
    const posts = (await list(admin.cookie, "?kind=post")).items;
    expect(posts.length).toBeGreaterThan(0);
    expect(posts.every((i) => i.kind === "post")).toBe(true);

    const drafts = (await list(admin.cookie, "?state=draft")).items;
    expect(drafts.every((i) => i.state === "draft")).toBe(true);

    expect((await call("/api/content?kind=advert", { cookie: admin.cookie })).status).toBe(400);
    expect((await call("/api/content?state=maybe", { cookie: admin.cookie })).status).toBe(400);
  });

  it("puts what was touched most recently first", async () => {
    const first = await newDraft({ title: "first" });
    const second = await newDraft({ title: "second" });
    const positions = async () => {
      const ids = (await list(admin.cookie)).items.map((i) => i.id);
      return { first: ids.indexOf(first), second: ids.indexOf(second) };
    };

    // Editing the older one puts it above the newer one, and editing the newer one puts it back on top.
    await new Promise((r) => setTimeout(r, 5));
    await call(`/api/content/${first}`, { method: "PATCH", cookie: admin.cookie, body: { title: "first, edited" } });
    expect((await positions()).first).toBeLessThan((await positions()).second);
    await new Promise((r) => setTimeout(r, 5));
    await call(`/api/content/${second}`, { method: "PATCH", cookie: admin.cookie, body: { title: "second, edited" } });
    expect((await positions()).second).toBeLessThan((await positions()).first);
  });

  it("carries the state and the author's name (D-098), but never the text or the contact", async () => {
    const id = await newDraft();
    const item = (await list(admin.cookie)).items.find((i) => i.id === id)!;
    expect(Object.keys(item).sort()).toEqual(["archivedAt", "authorName", "createdAt", "excerpt", "hideAfter", "hideAfterBs", "holidayFrom", "holidayFromBs", "holidayTo", "holidayToBs", "id", "kind", "publishOn", "publishOnBs", "publishTime", "publishedAt", "state", "status", "title", "updatedAt", "urgent"]);
  });
});

// ---------------------------------------------------------------------------------------------
describe("GET /api/content/{id}", () => {
  it("gives one item with its text and contact, in Nepali days too, and is never cached", async () => {
    const id = await newDraft({ kind: "vacancy", title: "Teacher wanted", body: "First\n\nSecond", contact: "jobs@school.example", urgent: true, publishOn: "2020-01-01", hideAfter: "2020-02-01" });
    const response = await call(`/api/content/${id}`, { cookie: admin.cookie });
    const item = (await response.json()) as Item & { publishOnBs: string | null; hideAfterBs: string | null };

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(item).toMatchObject({ id, kind: "vacancy", title: "Teacher wanted", body: "First\n\nSecond", contact: "jobs@school.example", urgent: true, status: "draft", state: "draft", publishOn: "2020-01-01", hideAfter: "2020-02-01" });
    expect(item.publishOnBs).toBe(adToBsText("2020-01-01"));
    expect(item.hideAfterBs).toBe(adToBsText("2020-02-01"));
    expect(Object.keys(item).sort()).toEqual(["archivedAt", "authorName", "body", "contact", "createdAt", "hideAfter", "hideAfterBs", "holidayFrom", "holidayFromBs", "holidayTo", "holidayToBs", "id", "kind", "publishOn", "publishOnBs", "publishTime", "publishedAt", "state", "status", "title", "updatedAt", "urgent"]);
  });

  it("says where a live item stands today", async () => {
    const id = await newDraft({ publishOn: "2020-01-01" });
    await call(`/api/content/${id}/publish`, { method: "POST", cookie: admin.cookie });
    expect((await detail(id)).state).toBe("showing");
  });

  it("404 for an item that does not exist, 400 for an id that cannot be one", async () => {
    expect((await call(`/api/content/${"d".repeat(32)}`, { cookie: admin.cookie })).status).toBe(404);
    expect((await call("/api/content/not-an-id", { cookie: admin.cookie })).status).toBe(400);
  });
});

describe("GET /api/content?limit", () => {
  it("returns at most that many, still with today's Nepali day, and refuses a limit that makes no sense", async () => {
    await newDraft();
    await newDraft();
    const one = (await (await call("/api/content?limit=1", { cookie: admin.cookie })).json()) as { items: unknown[]; todayBs: string | null };
    expect(one.items).toHaveLength(1);
    expect(one.todayBs).toBe(adToBsText(today()));

    // A page is at most 50 items since D-098 (paging happens in the database).
    for (const limit of ["0", "-1", "51", "abc", "1.5"]) {
      expect((await call(`/api/content?limit=${limit}`, { cookie: admin.cookie })).status, limit).toBe(400);
    }
    expect((await call("/api/content?limit=50", { cookie: admin.cookie })).status).toBe(200);
  });
});
