import { describe, expect, it } from "vitest";

import { signChallenge, verifyChallenge } from "../src/core/two-factor/challenge";
import { hashRecoveryCode, newRecoveryCodes, normaliseRecoveryCode } from "../src/core/two-factor/recovery";
import { newTotpSecret, otpauthUri, verifyTotp } from "../src/core/two-factor/totp";

// RFC 6238 Appendix B, SHA-1, secret "12345678901234567890". The RFC lists 8-digit codes; ours are the
// last 6 digits of the same value (both are the truncated HMAC modulo a power of ten).
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const RFC_VECTORS: [number, string][] = [
  [59, "287082"],
  [1111111109, "081804"],
  [1111111111, "050471"],
  [1234567890, "005924"],
  [2000000000, "279037"],
  [20000000000, "353130"],
];
const at = (seconds: number) => seconds * 1000;
const step = (seconds: number) => Math.floor(seconds / 30);

describe("TOTP", () => {
  it.each(RFC_VECTORS)("gives the RFC 6238 answer at %i seconds", (seconds, code) => {
    expect(verifyTotp(RFC_SECRET, code, at(seconds))).toBe(step(seconds));
  });

  it("returns the time step the code belongs to, so a code can be used only once", () => {
    // The code for step N is accepted at step N+1 (a phone clock a little slow) and reports step N.
    expect(verifyTotp(RFC_SECRET, "287082", at(59 + 30))).toBe(step(59));
    expect(verifyTotp(RFC_SECRET, "287082", at(59 - 30))).toBe(step(59));
  });

  it("accepts a code one step either side, and no further", () => {
    expect(verifyTotp(RFC_SECRET, "287082", at(59 + 60))).toBeNull();
    expect(verifyTotp(RFC_SECRET, "287082", at(59 - 60))).toBeNull();
  });

  it("refuses a wrong code, and anything that is not six digits", () => {
    for (const bad of ["000000", "287083", "28708", "2870822", "abcdef", "28 7082x", "", "      "]) {
      expect(verifyTotp(RFC_SECRET, bad, at(59)), bad).toBeNull();
    }
  });

  it("ignores spaces a person types in the middle, as phones show '287 082'", () => {
    expect(verifyTotp(RFC_SECRET, "287 082", at(59))).toBe(step(59));
    expect(verifyTotp(RFC_SECRET, " 287082 ", at(59))).toBe(step(59));
  });

  it("makes a new random secret each time, long enough (160 bits) and in a form authenticator apps accept", () => {
    const a = newTotpSecret();
    const b = newTotpSecret();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Z2-7]{32}$/); // 20 bytes in base32
  });

  it("builds the address an authenticator app scans or opens", () => {
    const uri = otpauthUri({ secret: RFC_SECRET, account: "help@school.example", issuer: "Royal Softech College" });
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(uri).toContain(`secret=${RFC_SECRET}`);
    expect(uri).toContain("issuer=Royal%20Softech%20College");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
    expect(decodeURIComponent(uri)).toContain("Royal Softech College:help@school.example");
  });
});

describe("recovery codes", () => {
  it("come as ten distinct codes, written in two groups so they are easy to copy by eye", () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
  });

  it("avoid characters that look alike (0/o, 1/l/i)", () => {
    for (const code of newRecoveryCodes(200)) expect(code).not.toMatch(/[01ilo]/);
  });

  it("are the same code whatever capitals, spaces or dashes the person types", () => {
    expect(normaliseRecoveryCode("ABCDE-FGHJK")).toBe("abcdefghjk");
    expect(normaliseRecoveryCode(" abcde fghjk ")).toBe("abcdefghjk");
    expect(normaliseRecoveryCode("abcdefghjk")).toBe("abcdefghjk");
  });

  it("are stored as a hash, the same for any way of writing the code", async () => {
    const [code] = newRecoveryCodes(1);
    const hash = await hashRecoveryCode(code!);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(code!.replace("-", ""));
    expect(await hashRecoveryCode(code!.toUpperCase())).toBe(hash);
    expect(await hashRecoveryCode(code!.replace("-", " "))).toBe(hash);
  });

  it("are refused when they are not the right shape, so a 6-digit code is never mistaken for one", async () => {
    expect(normaliseRecoveryCode("123456")).toBeNull();
    expect(normaliseRecoveryCode("abc")).toBeNull();
    expect(normaliseRecoveryCode("abcde-fghjk-extra")).toBeNull();
    expect(normaliseRecoveryCode("")).toBeNull();
  });
});

describe("challenge tokens", () => {
  const secret = "test-only-session-secret-0123456789abcdef0123456789abcdef";
  const now = 1_800_000_000;

  it("carry who and what for, and expire in five minutes", async () => {
    const token = await signChallenge(secret, { sub: "user-1", kind: "verify" }, now);
    expect(await verifyChallenge(secret, token, now + 299)).toEqual({ sub: "user-1", kind: "verify" });
    expect(await verifyChallenge(secret, token, now + 301)).toBeNull();
  });

  it("cannot be changed: a different subject or kind breaks the signature", async () => {
    const token = await signChallenge(secret, { sub: "user-1", kind: "verify" }, now);
    const [payload, signature] = token.split(".") as [string, string];
    const forged = btoa(JSON.stringify({ ...JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))), sub: "user-2" })).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    expect(await verifyChallenge(secret, `${forged}.${signature}`, now)).toBeNull();
    expect(await verifyChallenge("another-secret-0123456789abcdef0123456789abcdef", token, now)).toBeNull();
  });

  it("an access token is not a challenge, and a challenge is not an access token", async () => {
    const { signAccessToken, verifyAccessToken } = await import("../src/core/tokens");
    const access = await signAccessToken(secret, { sub: "u", sid: "s", name: "N", roles: [], iat: now, exp: now + 600 });
    expect(await verifyChallenge(secret, access, now)).toBeNull();
    const challenge = await signChallenge(secret, { sub: "u", kind: "setup" }, now);
    expect(await verifyAccessToken(secret, challenge, now)).toBeNull();
  });

  it("refuse garbage", async () => {
    for (const bad of ["", "x", "a.b", "a.b.c", ".", "....", "🙂"]) expect(await verifyChallenge(secret, bad, now), bad).toBeNull();
  });
});
