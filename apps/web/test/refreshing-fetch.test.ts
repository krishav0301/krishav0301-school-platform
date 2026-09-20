import { describe, expect, it, vi } from "vitest";

import { createRefreshingFetch } from "@/session/refreshing-fetch";

const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A fake network: answers by URL path, records every request it saw. */
function fakeNetwork(handlers: Record<string, () => Response | Promise<Response>>) {
  const seen: { url: string; method: string; body: string }[] = [];
  const network = async (input: Request) => {
    const path = new URL(input.url).pathname;
    seen.push({ url: path, method: input.method, body: await input.clone().text() });
    const handler = handlers[path];
    if (!handler) throw new Error(`unexpected request to ${input.url}`);
    return handler();
  };
  return { network, seen, calls: (path: string) => seen.filter((s) => s.url === path).length };
}

const request = (path: string, init?: RequestInit) => new Request(`https://school.example${path}`, init);

describe("createRefreshingFetch", () => {
  it("passes a normal response straight through, without touching the session", async () => {
    const net = fakeNetwork({ "/api/things": () => json(200, { ok: true }) });
    const onSignedOut = vi.fn();
    const send = createRefreshingFetch(net.network, { onSignedOut });

    expect((await send(request("/api/things"))).status).toBe(200);
    expect(net.calls("/api/auth/refresh")).toBe(0);
    expect(onSignedOut).not.toHaveBeenCalled();
  });

  it("on 401, refreshes once and repeats the request, including its body", async () => {
    let first = true;
    const net = fakeNetwork({
      "/api/things": () => (first ? ((first = false), json(401, { error: "unauthenticated" })) : json(200, { saved: true })),
      "/api/auth/refresh": () => json(200),
    });
    const send = createRefreshingFetch(net.network, { onSignedOut: vi.fn() });

    const response = await send(request("/api/things", { method: "POST", body: JSON.stringify({ a: 1 }), headers: { "Content-Type": "application/json" } }));

    expect(response.status).toBe(200);
    expect(net.seen.map((s) => `${s.method} ${s.url}`)).toEqual(["POST /api/things", "POST /api/auth/refresh", "POST /api/things"]);
    expect(net.seen[2]!.body).toBe('{"a":1}'); // the retry carries the same body
  });

  it("if the refresh is refused, returns the original 401 and says the person is signed out", async () => {
    const net = fakeNetwork({ "/api/things": () => json(401, { error: "unauthenticated" }), "/api/auth/refresh": () => json(401, { error: "unauthenticated" }) });
    const onSignedOut = vi.fn();
    const send = createRefreshingFetch(net.network, { onSignedOut });

    expect((await send(request("/api/things"))).status).toBe(401);
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    expect(net.calls("/api/things")).toBe(1); // no retry without a session
  });

  it("many requests failing at once share one refresh, because a refresh token works only once", async () => {
    const answered = new Set<string>();
    const once = (key: string) => () => (answered.has(key) ? json(200) : (answered.add(key), json(401)));
    const net = fakeNetwork({
      "/api/a": once("a"),
      "/api/b": once("b"),
      "/api/c": once("c"),
      "/api/auth/refresh": async () => (await new Promise((r) => setTimeout(r, 20)), json(200)),
    });
    const send = createRefreshingFetch(net.network, { onSignedOut: vi.fn() });

    const results = await Promise.all([send(request("/api/a")), send(request("/api/b")), send(request("/api/c"))]);

    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(net.calls("/api/auth/refresh")).toBe(1);
  });

  it("does not try to refresh when the failing request IS an auth request", async () => {
    for (const path of ["/api/auth/sign-in", "/api/auth/refresh", "/api/auth/sign-out"]) {
      const net = fakeNetwork({ [path]: () => json(401, { error: "invalid_credentials" }) });
      const onSignedOut = vi.fn();
      const send = createRefreshingFetch(net.network, { onSignedOut });

      expect((await send(request(path, { method: "POST" }))).status).toBe(401);
      expect(net.seen).toHaveLength(1);
      expect(onSignedOut).not.toHaveBeenCalled();
    }
  });

  it("DOES renew for /api/auth/me, because an expired access cookie is exactly when the page asks who you are", async () => {
    let asked = 0;
    const net = fakeNetwork({
      "/api/auth/me": () => (asked++ === 0 ? json(401) : json(200, { name: "Sita", roles: [] })),
      "/api/auth/refresh": () => json(200),
    });
    const send = createRefreshingFetch(net.network, { onSignedOut: vi.fn() });

    expect((await send(request("/api/auth/me"))).status).toBe(200);
    expect(net.calls("/api/auth/refresh")).toBe(1);
  });

  it("a refresh answered 'refresh_in_progress' (another tab is renewing) is retried once", async () => {
    let refreshes = 0;
    let things = 0;
    const net = fakeNetwork({
      "/api/things": () => (things++ === 0 ? json(401) : json(200)),
      "/api/auth/refresh": () => (refreshes++ === 0 ? json(401, { error: "refresh_in_progress" }) : json(200)),
    });
    const send = createRefreshingFetch(net.network, { onSignedOut: vi.fn(), retryDelayMs: 1 });

    expect((await send(request("/api/things"))).status).toBe(200);
    expect(refreshes).toBe(2);
  });

  it("never retries a request more than once, so a permanently failing route cannot loop", async () => {
    const net = fakeNetwork({ "/api/things": () => json(401), "/api/auth/refresh": () => json(200) });
    const send = createRefreshingFetch(net.network, { onSignedOut: vi.fn() });

    expect((await send(request("/api/things"))).status).toBe(401);
    expect(net.calls("/api/things")).toBe(2);
    expect(net.calls("/api/auth/refresh")).toBe(1);
  });

  it("leaves other errors alone: 400, 403, 404, 422, 429, 500, 503 are not signed-out", async () => {
    for (const status of [400, 403, 404, 422, 429, 500, 503]) {
      const net = fakeNetwork({ "/api/things": () => json(status) });
      const send = createRefreshingFetch(net.network, { onSignedOut: vi.fn() });
      expect((await send(request("/api/things"))).status).toBe(status);
      expect(net.seen).toHaveLength(1);
    }
  });

  it("a network failure during the refresh keeps the person signed in and returns the 401", async () => {
    const network = async (r: Request) => (new URL(r.url).pathname === "/api/things" ? json(401) : Promise.reject(new TypeError("offline")));
    const onSignedOut = vi.fn();
    const send = createRefreshingFetch(network, { onSignedOut });

    expect((await send(request("/api/things"))).status).toBe(401);
    expect(onSignedOut).not.toHaveBeenCalled(); // offline is not the same as signed out
  });
});
