import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { createUser } from "../src/modules/accounts/service";

const db = env.DB;
const app = createApp();
const password = "blue-river-lamp-2083";
const HINT = "__Host-signed-in";

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

const cookieLine = (response: Response, name: string) => response.headers.getSetCookie().find((line) => line.startsWith(`${name}=`));
const cookies = (response: Response) => response.headers.getSetCookie().map((line) => line.split(";")[0]!).join("; ");

let n = 0;
async function signedIn() {
  const email = `hint-${++n}-${crypto.randomUUID().slice(0, 6)}@school.example`;
  await createUser(db, env.AUDIT_HMAC_KEY, { email, password, fullName: "Hint Person", roles: [{ role: "teacher", scope: "assigned" }] });
  const response = await call("/api/auth/sign-in", { method: "POST", body: { email, password } });
  return { email, response, cookie: cookies(response) };
}

describe("the session hint: a cookie that only says 'there may be a session'", () => {
  it("is set at sign-in, readable by the page, and the real cookies stay hidden from page scripts", async () => {
    const { response } = await signedIn();
    expect(response.status).toBe(200);

    const hint = cookieLine(response, HINT)!;
    expect(hint).toBeDefined();
    expect(hint).toMatch(/^__Host-signed-in=1;/);
    expect(hint).toMatch(/Path=\//i);
    expect(hint).toMatch(/Secure/i);
    expect(hint).toMatch(/SameSite=Lax/i);
    expect(hint).toMatch(/Max-Age=2592000/i); // 30 days, like the sign-in itself
    expect(hint, "the hint is meant to be read by the page").not.toMatch(/HttpOnly/i);
    expect(hint).not.toMatch(/Domain=/i);

    for (const real of ["__Host-access", "__Host-refresh"]) {
      expect(cookieLine(response, real), real).toMatch(/HttpOnly/i);
    }
  });

  it("is set again whenever a session is renewed, so it never runs out while the session lives", async () => {
    const { cookie } = await signedIn();
    const renewed = await call("/api/auth/refresh", { method: "POST", cookie });
    expect(renewed.status).toBe(200);
    expect(cookieLine(renewed, HINT)).toMatch(/^__Host-signed-in=1;/);
  });

  it("is removed at sign-out", async () => {
    const { cookie } = await signedIn();
    const out = await call("/api/auth/sign-out", { method: "POST", cookie });
    const cleared = cookieLine(out, HINT)!;
    expect(cleared).toBeDefined();
    expect(cleared).toMatch(/Max-Age=0/i);
  });

  it("is removed when a session can no longer be renewed, so the page stops asking", async () => {
    const { cookie } = await signedIn();
    await call("/api/auth/sign-out", { method: "POST", cookie }); // ends the session
    const refused = await call("/api/auth/refresh", { method: "POST", cookie });
    expect(refused.status).toBe(401);
    expect(cookieLine(refused, HINT)).toMatch(/Max-Age=0/i);
  });

  it("is not set when the password was wrong, and not while a second step is still owed", async () => {
    const wrong = await call("/api/auth/sign-in", { method: "POST", body: { email: "nobody@school.example", password: "definitely-wrong-123" } });
    expect(wrong.status).toBe(401);
    expect(cookieLine(wrong, HINT)).toBeUndefined();

    const email = `hint-2fa-${crypto.randomUUID().slice(0, 6)}@school.example`;
    await createUser(db, env.AUDIT_HMAC_KEY, { email, password, fullName: "Owes A Step", roles: [{ role: "admin", scope: "institution" }] });
    const challenge = await call("/api/auth/sign-in", { method: "POST", body: { email, password } });
    expect(((await challenge.json()) as { twoFactor?: string }).twoFactor).toBe("setup");
    expect(challenge.headers.getSetCookie()).toHaveLength(0);
  });
});

describe("the hint never counts for anything on the server", () => {
  it("a hint on its own opens no door: every signed-in route still says 401", async () => {
    for (const path of ["/api/auth/me", "/api/content"]) {
      const response = await call(path, { cookie: `${HINT}=1` });
      expect(response.status, path).toBe(401);
    }
  });

  it("nor does a hint added to a valid session change what that session may do", async () => {
    const { cookie } = await signedIn();
    const plain = await call("/api/content", { cookie }); // a Teacher: 403
    const withHint = await call("/api/content", { cookie: `${cookie}; ${HINT}=1` });
    expect(plain.status).toBe(403);
    expect(withHint.status).toBe(403);
  });

  it("a session without the hint still works: the server does not look for it", async () => {
    const { cookie } = await signedIn();
    const withoutHint = cookie.split("; ").filter((c) => !c.startsWith(`${HINT}=`)).join("; ");
    expect((await call("/api/auth/me", { cookie: withoutHint })).status).toBe(200);
  });
});
