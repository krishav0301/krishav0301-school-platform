import { describe, expect, it } from "vitest";

import { createApiClient } from "@/api/client";
import { loadContent, loadItem, loadPublic, saveItem, setPublished, submitForm } from "@/content/client";
import type { FormValues } from "@/content/model";

interface Seen {
  method: string;
  path: string;
  body: unknown;
}

/** A client whose "network" answers from a script and remembers every request. */
function fake(answer: (seen: Seen) => Response | Promise<Response> | "offline") {
  const seen: Seen[] = [];
  const api = createApiClient({
    baseUrl: "http://school.test",
    fetch: async (request) => {
      const url = new URL(request.url);
      const entry: Seen = { method: request.method, path: url.pathname + url.search, body: request.method === "GET" ? undefined : await request.clone().json().catch(() => undefined) };
      seen.push(entry);
      const result = await answer(entry);
      if (result === "offline") throw new TypeError("offline");
      return result;
    },
  });
  return { api, seen };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const values: FormValues = { kind: "notice", title: "  Winter break ", body: " Closed on Friday. ", contact: "", urgent: false, publishOnBs: "2083-06-10", hideAfterBs: "" };
const toAd: Record<string, string> = { "2083-06-10": "2026-09-27", "2083-07-01": "2026-10-18" };
const convert = (seen: Seen) => {
  const bs = new URL(`http://x${seen.path}`).searchParams.get("bs")!;
  return toAd[bs] ? json(200, { ad: toAd[bs], confidence: "verified" }) : json(422, { error: "invalid_date" });
};

describe("loadContent", () => {
  it("asks for the whole list, or a filtered one, and hands back the items and today's Nepali day", async () => {
    const { api, seen } = fake(() => json(200, { items: [{ id: "a" }], todayBs: "2083-06-05" }));
    expect(await loadContent(api, {})).toEqual({ ok: true, items: [{ id: "a" }], todayBs: "2083-06-05" });
    await loadContent(api, { kind: "post", state: "draft" });
    await loadContent(api, { kind: "post" });
    expect(seen.map((s) => s.path)).toEqual(["/api/content", "/api/content?kind=post&state=draft", "/api/content?kind=post"]);
  });

  it("says forbidden for 403, failed for any other error or no network", async () => {
    expect(await loadContent(fake(() => json(403, { error: "forbidden" })).api, {})).toEqual({ ok: false, reason: "forbidden" });
    expect(await loadContent(fake(() => json(500, { error: "x" })).api, {})).toEqual({ ok: false, reason: "failed" });
    expect(await loadContent(fake(() => "offline").api, {})).toEqual({ ok: false, reason: "failed" });
  });
});

describe("loadContent with a limit", () => {
  it("asks for only that many, for a form that needs nothing but today's date", async () => {
    const { api, seen } = fake(() => json(200, { items: [], todayBs: "2083-06-05" }));
    await loadContent(api, { limit: 1 });
    expect(seen[0]!.path).toBe("/api/content?limit=1");
  });
});

describe("loadPublic", () => {
  it("asks the public route for what is on the site, with no sign-in, and hands back the items", async () => {
    const { api, seen } = fake(() => json(200, { items: [{ id: "a", kind: "notice" }] }));
    expect(await loadPublic(api)).toEqual({ ok: true, items: [{ id: "a", kind: "notice" }] });
    expect(seen[0]).toMatchObject({ method: "GET", path: "/api/site/content" });
  });

  it("says failed for any error or no network", async () => {
    expect(await loadPublic(fake(() => json(500, {})).api)).toEqual({ ok: false });
    expect(await loadPublic(fake(() => "offline").api)).toEqual({ ok: false });
  });
});

describe("loadItem", () => {
  it("fetches the one item by its id, with its text", async () => {
    const { api, seen } = fake(() => json(200, { id: "abc123", title: "T", body: "B" }));
    expect(await loadItem(api, "abc123")).toEqual({ ok: true, item: { id: "abc123", title: "T", body: "B" } });
    expect(seen[0]!.path).toBe("/api/content/abc123");
  });

  it("404 is not_found, 403 forbidden, anything else or no network failed", async () => {
    expect(await loadItem(fake(() => json(404, { error: "not_found" })).api, "x")).toEqual({ ok: false, reason: "not_found" });
    expect(await loadItem(fake(() => json(403, { error: "forbidden" })).api, "x")).toEqual({ ok: false, reason: "forbidden" });
    expect(await loadItem(fake(() => json(500, {})).api, "x")).toEqual({ ok: false, reason: "failed" });
    expect(await loadItem(fake(() => "offline").api, "x")).toEqual({ ok: false, reason: "failed" });
  });
});

describe("saveItem: a new item", () => {
  it("turns the Nepali days into AD first, then sends a trimmed draft, and hands back its id", async () => {
    const { api, seen } = fake((s) => (s.method === "GET" ? convert(s) : json(201, { id: "new1" })));
    const result = await saveItem(api, null, { ...values, hideAfterBs: "2083-07-01" });

    expect(result).toEqual({ ok: true, id: "new1" });
    const post = seen.find((s) => s.method === "POST")!;
    expect(post.path).toBe("/api/content");
    expect(post.body).toEqual({ kind: "notice", title: "Winter break", body: "Closed on Friday.", contact: null, urgent: false, publishOn: "2026-09-27", hideAfter: "2026-10-18" });
    expect(seen.filter((s) => s.method === "GET").map((s) => s.path).sort()).toEqual(["/api/dates/to-ad?bs=2083-06-10", "/api/dates/to-ad?bs=2083-07-01"]);
  });

  it("leaves the hide-after day out, and sends no contact for anything but a vacancy", async () => {
    const { api, seen } = fake((s) => (s.method === "GET" ? convert(s) : json(201, { id: "n" })));
    await saveItem(api, null, { ...values, contact: "leftover@school.example" });
    expect(seen.find((s) => s.method === "POST")!.body).toMatchObject({ contact: null, hideAfter: null });
    expect(seen.filter((s) => s.method === "GET")).toHaveLength(1);
  });

  it("sends a vacancy's contact, trimmed", async () => {
    const { api, seen } = fake((s) => (s.method === "GET" ? convert(s) : json(201, { id: "n" })));
    await saveItem(api, null, { ...values, kind: "vacancy", contact: " jobs@school.example " });
    expect(seen.find((s) => s.method === "POST")!.body).toMatchObject({ kind: "vacancy", contact: "jobs@school.example" });
  });

  it("sends nothing when a day cannot be converted, and points at that field", async () => {
    const { api, seen } = fake((s) => (s.path.includes("2083-06-10") ? json(422, { error: "invalid_date" }) : convert(s)));
    expect(await saveItem(api, null, values)).toEqual({ ok: false, reason: "fields", errors: { publishOnBs: "contentForm.error.dateInvalid" } });
    expect(seen.some((s) => s.method === "POST")).toBe(false);
  });

  it("names the right field and the right words for each kind of date problem, both days at once", async () => {
    const { api } = fake((s) => (s.path.includes("2083-06-10") ? json(422, { error: "unverified_year" }) : json(422, { error: "invalid_date" })));
    expect(await saveItem(api, null, { ...values, hideAfterBs: "2083-08-40" })).toEqual({
      ok: false,
      reason: "fields",
      errors: { publishOnBs: "contentForm.error.dateUnverified", hideAfterBs: "contentForm.error.dateInvalid" },
    });
  });

  it("does not even ask the server when the form itself is wrong", async () => {
    const { api, seen } = fake(() => json(500, {}));
    const result = await saveItem(api, null, { ...values, title: "" });
    expect(result).toEqual({ ok: false, reason: "fields", errors: { title: "contentForm.error.titleRequired" } });
    expect(seen).toHaveLength(0);
  });

  it("maps what the server says: 422 rejected, 403 forbidden, anything else or no network failed", async () => {
    const attempt = (answer: Response | "offline") => saveItem(fake((s) => (s.method === "GET" ? convert(s) : answer)).api, null, values);
    expect(await attempt(json(422, { error: "invalid", message: "x" }))).toEqual({ ok: false, reason: "rejected" });
    expect(await attempt(json(400, {}))).toEqual({ ok: false, reason: "rejected" });
    expect(await attempt(json(403, { error: "forbidden" }))).toEqual({ ok: false, reason: "forbidden" });
    expect(await attempt(json(500, {}))).toEqual({ ok: false, reason: "failed" });
    expect(await attempt("offline")).toEqual({ ok: false, reason: "failed" });
  });

  it("says failed when the conversion itself cannot be reached", async () => {
    expect(await saveItem(fake(() => "offline").api, null, values)).toEqual({ ok: false, reason: "failed" });
  });
});

describe("saveItem: an existing item", () => {
  it("patches that item with every editable field, and never the kind", async () => {
    const { api, seen } = fake((s) => (s.method === "GET" ? convert(s) : json(200, { ok: true })));
    const result = await saveItem(api, "abc123", { ...values, urgent: true });

    expect(result).toEqual({ ok: true, id: "abc123" });
    const patch = seen.find((s) => s.method === "PATCH")!;
    expect(patch.path).toBe("/api/content/abc123");
    expect(patch.body).toEqual({ title: "Winter break", body: "Closed on Friday.", contact: null, urgent: true, publishOn: "2026-09-27", hideAfter: null });
    expect(patch.body).not.toHaveProperty("kind");
  });

  it("404 is not_found, and the other answers map as for a new item", async () => {
    const attempt = (answer: Response) => saveItem(fake((s) => (s.method === "GET" ? convert(s) : answer)).api, "abc123", values);
    expect(await attempt(json(404, { error: "not_found" }))).toEqual({ ok: false, reason: "not_found" });
    expect(await attempt(json(422, { error: "invalid", message: "m" }))).toEqual({ ok: false, reason: "rejected" });
    expect(await attempt(json(403, {}))).toEqual({ ok: false, reason: "forbidden" });
  });
});

describe("submitForm: save, and with publish also put it on the website", () => {
  const route = (over: { save?: Response | "offline"; publish?: Response | "offline" } = {}) =>
    fake((s) => {
      if (s.method === "GET") return convert(s);
      if (s.path.endsWith("/publish")) return over.publish ?? json(200, { ok: true });
      return over.save ?? (s.method === "POST" ? json(201, { id: "new1" }) : json(200, { ok: true }));
    });
  const calls = (seen: Seen[]) => seen.filter((s) => s.method !== "GET").map((s) => `${s.method} ${s.path}`);

  it("save only: a new item is created and an existing one updated, and nothing is published", async () => {
    const created = route();
    expect(await submitForm(created.api, null, values, false)).toEqual({ done: "created" });
    expect(calls(created.seen)).toEqual(["POST /api/content"]);

    const updated = route();
    expect(await submitForm(updated.api, "abc123", values, false)).toEqual({ done: "updated" });
    expect(calls(updated.seen)).toEqual(["PATCH /api/content/abc123"]);
  });

  it("with publish: saves first, then publishes the item it saved (a new one by its new id)", async () => {
    const created = route();
    expect(await submitForm(created.api, null, values, true)).toEqual({ done: "published" });
    expect(calls(created.seen)).toEqual(["POST /api/content", "POST /api/content/new1/publish"]);

    const edited = route();
    expect(await submitForm(edited.api, "abc123", values, true)).toEqual({ done: "published" });
    expect(calls(edited.seen)).toEqual(["PATCH /api/content/abc123", "POST /api/content/abc123/publish"]);
  });

  it("someone else already published it (409): the person still gets what they wanted", async () => {
    const r = route({ publish: json(409, { error: "already_live" }) });
    expect(await submitForm(r.api, "abc123", values, true)).toEqual({ done: "published" });
  });

  it("saved but could not be published (refused, or no network): reported as saved as a draft, and nothing is saved twice", async () => {
    for (const publish of [json(403, { error: "forbidden" }), json(500, {}), "offline" as const]) {
      const r = route({ publish });
      expect(await submitForm(r.api, null, values, true)).toEqual({ done: "saved_unpublished" });
      expect(calls(r.seen).filter((c) => c === "POST /api/content"), "created once").toHaveLength(1);
    }
  });

  it("the item vanished while publishing: says gone", async () => {
    expect(await submitForm(route({ publish: json(404, { error: "not_found" }) }).api, "abc123", values, true)).toEqual({ gone: true });
  });

  it("a save that fails stops there: nothing is published, and the person stays on the form with the reason", async () => {
    const rejected = route({ save: json(422, { error: "invalid", message: "m" }) });
    expect(await submitForm(rejected.api, null, values, true)).toEqual({ problem: "rejected" });
    expect(calls(rejected.seen)).toEqual(["POST /api/content"]);

    expect(await submitForm(route({ save: json(403, {}) }).api, null, values, true)).toEqual({ problem: "forbidden" });
    expect(await submitForm(route({ save: json(500, {}) }).api, null, values, false)).toEqual({ problem: "failed" });
    expect(await submitForm(route({ save: json(404, {}) }).api, "abc123", values, true)).toEqual({ gone: true });
  });

  it("a problem with the form itself is reported against its fields, and nothing is sent", async () => {
    const r = route();
    expect(await submitForm(r.api, null, { ...values, title: "" }, true)).toEqual({ fields: { title: "contentForm.error.titleRequired" } });
    expect(r.seen).toHaveLength(0);
  });
});

describe("setPublished", () => {
  it("publishes or takes down the named item", async () => {
    const { api, seen } = fake(() => json(200, { ok: true }));
    expect(await setPublished(api, "abc123", true)).toEqual({ ok: true });
    expect(await setPublished(api, "abc123", false)).toEqual({ ok: true });
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual(["POST /api/content/abc123/publish", "POST /api/content/abc123/unpublish"]);
  });

  it("409 is a conflict (someone got there first), 404 gone, 403 forbidden, the rest failed", async () => {
    const attempt = (answer: Response | "offline") => setPublished(fake(() => answer).api, "abc123", true);
    expect(await attempt(json(409, { error: "already_live" }))).toEqual({ ok: false, reason: "conflict" });
    expect(await attempt(json(404, { error: "not_found" }))).toEqual({ ok: false, reason: "gone" });
    expect(await attempt(json(403, { error: "forbidden" }))).toEqual({ ok: false, reason: "forbidden" });
    expect(await attempt(json(500, {}))).toEqual({ ok: false, reason: "failed" });
    expect(await attempt("offline")).toEqual({ ok: false, reason: "failed" });
  });
});
