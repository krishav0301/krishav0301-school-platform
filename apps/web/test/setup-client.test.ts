import { describe, expect, it } from "vitest";

import { createApiClient } from "@/api/client";
import {
  activateYear,
  addLevel,
  createClass,
  createProgramme,
  createTerminal,
  createYear,
  loadClasses,
  loadProgrammes,
  loadTerminals,
  loadYears,
  setClassActive,
  setLevelActive,
  setProgrammeActive,
} from "@/setup/client";

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
const id = "a".repeat(32);

describe("loading", () => {
  it("returns the data on 200", async () => {
    const { api, seen } = fake(() => reply(200, { years: [] }));
    expect(await loadYears(api)).toEqual({ ok: true, data: { years: [] } });
    expect(seen[0]).toMatchObject({ method: "GET", path: "/api/academics/years" });
  });

  it("asks for one year's classes and terminals by query", async () => {
    const { api, seen } = fake(() => reply(200, { classes: [], terminals: [] }));
    await loadClasses(api, id);
    await loadTerminals(api, id);
    expect(seen.map((s) => s.path)).toEqual([`/api/academics/classes?year=${id}`, `/api/academics/terminals?year=${id}`]);
  });

  it("403 is forbidden, any other failure and a dropped connection are failed", async () => {
    expect(await loadProgrammes(fake(() => reply(403, { error: "forbidden" })).api)).toEqual({ ok: false, reason: "forbidden" });
    expect(await loadProgrammes(fake(() => reply(500, {})).api)).toEqual({ ok: false, reason: "failed" });
    expect(await loadProgrammes(fake(() => "offline").api)).toEqual({ ok: false, reason: "failed" });
  });
});

describe("createYear", () => {
  const values = { bsYear: "2083", startBs: "2083-01-01", endBs: "2083-12-30" };
  const script = (seen: Seen) => {
    if (seen.path.startsWith("/api/dates/to-ad")) return reply(200, { ad: seen.path.includes("2083-01-01") ? "2026-04-14" : "2027-04-13" });
    return reply(201, { id });
  };

  it("converts both Nepali days on the server, then sends the AD days and the BS year", async () => {
    const { api, seen } = fake(script);
    expect(await createYear(api, values)).toEqual({ ok: true, id });
    const post = seen.find((s) => s.method === "POST")!;
    expect(post).toMatchObject({ path: "/api/academics/years", body: { bsYear: 2083, startDate: "2026-04-14", endDate: "2027-04-13" } });
  });

  it("checks the form first and sends nothing when it is empty", async () => {
    const { api, seen } = fake(script);
    const result = await createYear(api, { bsYear: "", startBs: "", endBs: "" });
    expect(result).toMatchObject({ ok: false, reason: "fields", errors: { bsYear: "setup.error.bsYear", startBs: "setup.error.startRequired", endBs: "setup.error.endRequired" } });
    expect(seen).toEqual([]);
  });

  it("a day that does not exist, or whose year is not verified, comes back against its own field, and nothing is created", async () => {
    const invalid = fake((s) => (s.path.includes("2083-01-01") ? reply(422, { error: "invalid_date" }) : script(s)));
    expect(await createYear(invalid.api, values)).toMatchObject({ ok: false, reason: "fields", errors: { startBs: "setup.error.dateInvalid" } });
    expect(invalid.seen.some((s) => s.method === "POST")).toBe(false);

    const unverified = fake((s) => (s.path.includes("2083-12-30") ? reply(422, { error: "unverified_year" }) : script(s)));
    expect(await createYear(unverified.api, values)).toMatchObject({ ok: false, reason: "fields", errors: { endBs: "setup.error.dateUnverified" } });
  });

  it("maps the server's answers: 422 rejected, 409 conflict, 403 forbidden, a dropped connection failed", async () => {
    const withPost = (status: number, body: unknown) => fake((s) => (s.method === "POST" ? reply(status, body) : script(s))).api;
    expect(await createYear(withPost(422, { error: "invalid", message: "x" }), values)).toEqual({ ok: false, reason: "rejected" });
    expect(await createYear(withPost(409, { error: "conflict" }), values)).toEqual({ ok: false, reason: "conflict" });
    expect(await createYear(withPost(403, { error: "forbidden" }), values)).toEqual({ ok: false, reason: "forbidden" });
    expect(await createYear(fake((s) => (s.method === "POST" ? "offline" : script(s))).api, values)).toEqual({ ok: false, reason: "failed" });
  });
});

describe("the other writes", () => {
  it("send what the API expects", async () => {
    const { api, seen } = fake(() => reply(201, { id }));
    await createProgramme(api, { name: "BBS", sectionKey: "bachelors", affiliation: "TU" });
    await addLevel(api, id, "Year 1");
    await createClass(api, { yearId: id, levelId: id, label: "Morning" });
    await createTerminal(api, { yearId: id, name: "First" });
    expect(seen.map((s) => [s.method, s.path, s.body])).toEqual([
      ["POST", "/api/academics/programmes", { name: "BBS", sectionKey: "bachelors", affiliation: "TU" }],
      ["POST", `/api/academics/programmes/${id}/levels`, { name: "Year 1" }],
      ["POST", "/api/academics/classes", { yearId: id, levelId: id, label: "Morning" }],
      ["POST", "/api/academics/terminals", { yearId: id, name: "First" }],
    ]);
  });

  it("Add a Programme sends no grading choice, which the API's strict body would refuse (FUT F-02)", async () => {
    const { api, seen } = fake(() => reply(201, { id }));
    // What the Add a Programme form hands over: its values include the (hidden) grading choice.
    const fromForm = { name: "+2 Science", affiliation: "NEB", gradingPolicy: null, sectionKey: "plus2" };
    await createProgramme(api, fromForm);
    expect(seen[0]!.body).toEqual({ name: "+2 Science", sectionKey: "plus2", affiliation: "NEB" });
  });

  it("switch things off and on, and make a year current", async () => {
    const { api, seen } = fake(() => reply(200, { ok: true }));
    expect(await setProgrammeActive(api, id, false)).toEqual({ ok: true });
    await setLevelActive(api, id, true);
    await setClassActive(api, id, false);
    await activateYear(api, id);
    expect(seen.map((s) => [s.method, s.path, s.body])).toEqual([
      ["PATCH", `/api/academics/programmes/${id}`, { active: false }],
      ["PATCH", `/api/academics/levels/${id}`, { active: true }],
      ["PATCH", `/api/academics/classes/${id}`, { active: false }],
      ["POST", `/api/academics/years/${id}/activate`, undefined],
    ]);
  });

  it("409 keeps its word: a closed year and another active year are told apart from a repeat", async () => {
    const closed = fake(() => reply(409, { error: "year_closed" })).api;
    expect(await createClass(closed, { yearId: id, levelId: id, label: "" })).toEqual({ ok: false, reason: "year_closed" });
    expect(await createTerminal(closed, { yearId: id, name: "x" })).toEqual({ ok: false, reason: "year_closed" });
    expect(await activateYear(fake(() => reply(409, { error: "another_active" })).api, id)).toEqual({ ok: false, reason: "another_active" });
    expect(await createClass(fake(() => reply(409, { error: "conflict" })).api, { yearId: id, levelId: id, label: "" })).toEqual({ ok: false, reason: "conflict" });
  });

  it("404 is not_found, and a dropped connection is failed, for every write", async () => {
    const gone = fake(() => reply(404, { error: "not_found" })).api;
    expect(await addLevel(gone, id, "x")).toEqual({ ok: false, reason: "not_found" });
    expect(await setClassActive(gone, id, true)).toEqual({ ok: false, reason: "not_found" });
    const offline = fake(() => "offline").api;
    expect(await createProgramme(offline, { name: "x", sectionKey: "plus2", affiliation: "y" })).toEqual({ ok: false, reason: "failed" });
    expect(await activateYear(offline, id)).toEqual({ ok: false, reason: "failed" });
  });
});
