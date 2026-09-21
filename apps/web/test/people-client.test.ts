import { describe, expect, it } from "vitest";

import { createApiClient } from "@/api/client";
import { createStaff, createTeacher, issueTemporaryPassword, loadStaff, setStaffActive } from "@/people/client";

interface Seen {
  method: string;
  path: string;
  body: unknown;
}

/** A client whose "network" answers from a script and remembers every request. */
function fake(answer: (seen: Seen) => Response | "offline") {
  const seen: Seen[] = [];
  const api = createApiClient({
    baseUrl: "http://school.test",
    fetch: async (request) => {
      const url = new URL(request.url);
      const entry: Seen = { method: request.method, path: url.pathname + url.search, body: request.method === "GET" ? undefined : await request.clone().json().catch(() => undefined) };
      seen.push(entry);
      const result = answer(entry);
      if (result === "offline") throw new TypeError("offline");
      return result;
    },
  });
  return { api, seen };
}
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const id = "c".repeat(32);

describe("loading the staff", () => {
  it("returns the list on 200; 403 is forbidden; a dropped connection and any other failure are failed", async () => {
    expect(await loadStaff(fake(() => reply(200, { staff: [] })).api)).toEqual({ ok: true, data: { staff: [] } });
    expect(await loadStaff(fake(() => reply(403, { error: "forbidden" })).api)).toEqual({ ok: false, reason: "forbidden" });
    expect(await loadStaff(fake(() => reply(500, {})).api)).toEqual({ ok: false, reason: "failed" });
    expect(await loadStaff(fake(() => "offline").api)).toEqual({ ok: false, reason: "failed" });
  });
});

describe("adding people", () => {
  it("a Co-ordinator or Accountant: the phone only when there is one, and no section means the whole school (null)", async () => {
    const { api, seen } = fake(() => reply(201, { id, temporaryPassword: "K7M2-QX9R-4TBW-HC3P" }));
    expect(await createStaff(api, { fullName: "Sita Sharma", email: "sita@school.example", phone: "", role: "coordinator", sectionKey: "" })).toEqual({ ok: true, id, temporaryPassword: "K7M2-QX9R-4TBW-HC3P" });
    await createStaff(api, { fullName: "Hari Rai", email: "hari@school.example", phone: "9841234567", role: "accountant", sectionKey: "plus2" });
    expect(seen.map((s) => [s.method, s.path, s.body])).toEqual([
      ["POST", "/api/staff", { fullName: "Sita Sharma", email: "sita@school.example", role: "coordinator", sectionKey: null }],
      ["POST", "/api/staff", { fullName: "Hari Rai", email: "hari@school.example", phone: "9841234567", role: "accountant", sectionKey: "plus2" }],
    ]);
  });

  it("a teacher goes to its own address with a home section", async () => {
    const { api, seen } = fake(() => reply(201, { id, temporaryPassword: "K7M2-QX9R-4TBW-HC3P" }));
    await createTeacher(api, { fullName: "Ram Karki", email: "ram@school.example", phone: "", sectionKey: "plus2" });
    expect(seen[0]).toMatchObject({ method: "POST", path: "/api/teachers", body: { fullName: "Ram Karki", email: "ram@school.example", homeSectionKey: "plus2" } });
    expect(seen[0]!.body).not.toHaveProperty("phone");
  });

  it("maps the answers: 403 forbidden, 404 not_found, 409 email_taken, 400 and 422 rejected, a dropped connection failed", async () => {
    const form = { fullName: "Sita Sharma", email: "sita@school.example", phone: "", role: "coordinator" as const, sectionKey: "" };
    const once = (status: number, body: unknown) => fake(() => reply(status, body)).api;
    expect(await createStaff(once(403, { error: "forbidden" }), form)).toEqual({ ok: false, reason: "forbidden" });
    expect(await createStaff(once(404, { error: "not_found" }), form)).toEqual({ ok: false, reason: "not_found" });
    expect(await createStaff(once(409, { error: "email_taken" }), form)).toEqual({ ok: false, reason: "email_taken" });
    expect(await createStaff(once(422, { error: "invalid", message: "x" }), form)).toEqual({ ok: false, reason: "rejected" });
    expect(await createStaff(once(400, {}), form)).toEqual({ ok: false, reason: "rejected" });
    expect(await createStaff(fake(() => "offline").api, form)).toEqual({ ok: false, reason: "failed" });
  });
});

describe("switching and re-passwording", () => {
  it("switching sends the flag; the answer maps the same way", async () => {
    const { api, seen } = fake(() => reply(200, { ok: true }));
    expect(await setStaffActive(api, id, false)).toEqual({ ok: true });
    await setStaffActive(api, id, true);
    expect(seen.map((s) => [s.method, s.path, s.body])).toEqual([
      ["PATCH", `/api/staff/${id}`, { active: false }],
      ["PATCH", `/api/staff/${id}`, { active: true }],
    ]);
    expect(await setStaffActive(fake(() => reply(403, { error: "forbidden" })).api, id, false)).toEqual({ ok: false, reason: "forbidden" });
  });

  it("a new temporary password comes back once, and failures map", async () => {
    const { api, seen } = fake(() => reply(200, { temporaryPassword: "K7M2-QX9R-4TBW-HC3P" }));
    expect(await issueTemporaryPassword(api, id)).toEqual({ ok: true, temporaryPassword: "K7M2-QX9R-4TBW-HC3P" });
    expect(seen[0]).toMatchObject({ method: "POST", path: `/api/staff/${id}/temporary-password` });
    expect(await issueTemporaryPassword(fake(() => reply(404, { error: "not_found" })).api, id)).toEqual({ ok: false, reason: "not_found" });
    expect(await issueTemporaryPassword(fake(() => "offline").api, id)).toEqual({ ok: false, reason: "failed" });
  });
});
