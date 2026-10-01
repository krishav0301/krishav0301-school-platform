import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { adToBsText, nepalDate } from "../src/core/dates";
import { signAccessToken, type RoleClaim } from "../src/core/tokens";
import { createUser } from "../src/modules/accounts/service";
import { createContent, publishContent } from "../src/modules/content/service";

const db = env.DB;
const key = env.AUDIT_HMAC_KEY;
const app = createApp();

const call = (path: string, init: { method?: string; cookie?: string; headers?: Record<string, string> } = {}) =>
  app.request(
    `https://school.example${path}`,
    { method: init.method ?? "GET", headers: { "Sec-Fetch-Site": "same-origin", ...(init.cookie ? { Cookie: init.cookie } : {}), ...init.headers } },
    env,
  );

async function cookieFor(publicId: string, roles: RoleClaim[]) {
  const now = Math.floor(Date.now() / 1000);
  return `__Host-access=${await signAccessToken(env.SESSION_SECRET, { sub: publicId, sid: "s", name: "Person", roles, iat: now, exp: now + 600 })}`;
}

const today = () => nepalDate(new Date());
let admin = "";
let liveId = "";
let draftId = "";
let futureId = "";
let expiredId = "";
let vacancyId = "";

beforeAll(async () => {
  admin = (await createUser(db, key, { email: `admin-${crypto.randomUUID().slice(0, 6)}@school.example`, password: "blue-river-lamp-2083", fullName: "Admin Person", roles: [{ role: "admin", scope: "institution" }] })).publicId;
  const make = async (over: Record<string, unknown>, publish: boolean) => {
    const result = await createContent(db, key, admin, { kind: "notice", title: "T", body: "B", contact: null, urgent: false, publishOn: "2020-01-01", hideAfter: null, ...over } as never);
    if (!result.ok) throw new Error(result.reason);
    if (publish) await publishContent(db, key, admin, result.publicId);
    return result.publicId;
  };
  liveId = await make({ title: "Live notice", body: "Shown to everyone" }, true);
  draftId = await make({ title: "Secret draft" }, false);
  futureId = await make({ title: "Not yet", publishOn: "2999-01-01" }, true);
  expiredId = await make({ title: "Gone", publishOn: "2020-01-01", hideAfter: "2020-01-02" }, true);
  vacancyId = await make({ kind: "vacancy", title: "Teacher wanted", contact: "jobs@school.example" }, true);
});

type Body = { items: { id: string; kind: string; title: string; body: string; contact: string | null; urgent: boolean; publishedOn: string; hideAfter: string | null }[] };

describe("GET /api/site/content", () => {
  it("anyone may read it, with no sign-in, and sees the live items in date", async () => {
    const response = await call("/api/site/content");
    const body = (await response.json()) as Body;

    expect(response.status).toBe(200);
    const ids = body.items.map((i) => i.id);
    expect(ids).toContain(liveId);
    expect(ids).toContain(vacancyId);
    expect(ids).not.toContain(draftId);
    expect(ids).not.toContain(futureId);
    expect(ids).not.toContain(expiredId);
    expect(today() >= "2020-01-01").toBe(true);
  });

  it("is a short-lived public cache, so a change shows within about a minute (D-039)", async () => {
    const response = await call("/api/site/content");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=30, stale-while-revalidate=30");
  });

  it("gives a signed-in person exactly the same answer as a visitor, whatever their role", async () => {
    const visitor = await (await call("/api/site/content")).json();
    for (const role of [{ role: "student", scope: "own" }, { role: "admin", scope: "institution" }] as RoleClaim[]) {
      const cookie = await cookieFor("someone", [role]);
      const response = await call("/api/site/content", { cookie });
      expect(response.status, role.role).toBe(200);
      expect(await response.json(), role.role).toEqual(visitor);
    }
  });

  it("carries only public fields, dates as plain calendar days", async () => {
    const body = (await (await call("/api/site/content")).json()) as Body;
    const vacancy = body.items.find((i) => i.id === vacancyId)!;

    expect(Object.keys(vacancy).sort()).toEqual(["body", "contact", "hideAfter", "hideAfterBs", "holidayFrom", "holidayFromBs", "holidayTo", "holidayToBs", "id", "kind", "publishedOn", "publishedOnBs", "title", "urgent"]);
    expect(vacancy).toMatchObject({ kind: "vacancy", title: "Teacher wanted", contact: "jobs@school.example", urgent: false, hideAfter: null });
    expect(vacancy.publishedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(JSON.stringify(body)).not.toMatch(/created_by|published_by|"status"|users?_id/);
  });

  it("carries every day in Bikram Sambat too, so the page never converts a date itself", async () => {
    const body = (await (await call("/api/site/content")).json()) as { items: { id: string; publishedOn: string; publishedOnBs: string | null; hideAfterBs: string | null }[] };
    const live = body.items.find((i) => i.id === liveId)!;
    expect(live.publishedOn).toBe("2020-01-01");
    expect(live.publishedOnBs).toBe(adToBsText("2020-01-01"));
    expect(live.publishedOnBs).toMatch(/^20\d\d-\d{2}-\d{2}$/);
    expect(live.hideAfterBs).toBeNull();
  });

  it("can be narrowed to one kind, and refuses a kind that does not exist", async () => {
    const vacancies = (await (await call("/api/site/content?kind=vacancy")).json()) as Body;
    expect(vacancies.items.length).toBeGreaterThan(0);
    expect(vacancies.items.every((i) => i.kind === "vacancy")).toBe(true);

    expect((await call("/api/site/content?kind=advert")).status).toBe(400);
  });

  it("is read-only: writing to it is refused", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await call("/api/site/content", { method });
      expect([404, 405], method).toContain(response.status);
    }
  });

  it("a sign-in cookie that is forged changes nothing: it is still just the public answer", async () => {
    const response = await call("/api/site/content", { cookie: "__Host-access=not-a-real-token" });
    expect(response.status).toBe(200);
  });
});
