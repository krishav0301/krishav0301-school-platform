import { describe, expect, it } from "vitest";

import {
  ACCESS_TTL_SECONDS,
  newRefreshToken,
  sha256Hex,
  signAccessToken,
  verifyAccessToken,
  type AccessClaims,
} from "../src/core/tokens";

const secret = "test-session-secret-0123456789abcdef0123456789abcdef";
const now = 1_800_000_000;

const claims: AccessClaims = {
  sub: "user-public-id",
  sid: "session-public-id",
  name: "Test Person",
  roles: [{ role: "coordinator", scope: "institution" }],
  iat: now,
  exp: now + ACCESS_TTL_SECONDS,
};

describe("access tokens", () => {
  it("lasts 30 minutes (kept short by the free plan's write budget, D-021)", () => {
    expect(ACCESS_TTL_SECONDS).toBe(30 * 60);
  });

  it("round-trips its claims", async () => {
    const token = await signAccessToken(secret, claims);
    expect(await verifyAccessToken(secret, token, now + 5)).toEqual(claims);
  });

  it("is refused after it expires, and accepted right up to the last second", async () => {
    const token = await signAccessToken(secret, claims);
    expect(await verifyAccessToken(secret, token, claims.exp - 1)).not.toBeNull();
    expect(await verifyAccessToken(secret, token, claims.exp)).toBeNull();
  });

  it("is refused with a different secret", async () => {
    const token = await signAccessToken(secret, claims);
    expect(await verifyAccessToken("another-secret-entirely-0123456789abcdef", token, now)).toBeNull();
  });

  it("is refused if any part of the payload is changed", async () => {
    const token = await signAccessToken(secret, claims);
    const [payload, signature] = token.split(".") as [string, string];
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    decoded.roles = [{ role: "admin", scope: "institution" }]; // promote yourself
    const forged = btoa(JSON.stringify(decoded)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    expect(await verifyAccessToken(secret, `${forged}.${signature}`, now)).toBeNull();
  });

  it.each(["", "abc", "a.b.c", ".", "..", "not-a-token.at-all", "eyJ.eyJ"])("refuses the malformed token %j", async (bad) => {
    expect(await verifyAccessToken(secret, bad, now)).toBeNull();
  });

  it("refuses an unsigned token (the classic 'alg none' trick)", async () => {
    const payload = btoa(JSON.stringify(claims)).replace(/=+$/, "");
    expect(await verifyAccessToken(secret, `${payload}.`, now)).toBeNull();
    expect(await verifyAccessToken(secret, payload, now)).toBeNull();
  });

  it("refuses a token with an unknown version", async () => {
    const token = await signAccessToken(secret, { ...claims, v: 2 } as AccessClaims);
    expect(await verifyAccessToken(secret, token, now)).toBeNull();
  });
});

describe("refresh tokens", () => {
  it("are long, random, and URL-safe", () => {
    const token = newRefreshToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes
    expect(newRefreshToken()).not.toBe(token);
  });

  it("are stored only as a SHA-256 hash", async () => {
    const hash = await sha256Hex("some-token");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(await sha256Hex("some-token"));
    expect(hash).not.toBe(await sha256Hex("some-token2"));
  });
});
