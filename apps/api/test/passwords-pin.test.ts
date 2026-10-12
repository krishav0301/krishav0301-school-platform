import { describe, expect, it } from "vitest";

import { hashPassword, hashPin, isPinHash, needsRehash, verifyPassword } from "../src/core/passwords";

// A student's 4-digit password gets a light, keyed hash (the PM, 2026-10-12, D-164): scrypt took more processing than the
// free plan allows for one request and failed at random. A 4-digit password has only 10,000 possibilities, so a heavy hash
// protects nothing there; what protects it is the key held by the server (not in the database) and the lockout.

const SECRET = "a-long-server-side-secret-for-the-tests";

describe("a student's 4-digit password hash", () => {
  it("is a different shape from the strong hash, and says so", () => {
    const pin = hashPin("4821", SECRET);
    expect(pin.startsWith("pin1$")).toBe(true);
    expect(isPinHash(pin)).toBe(true);
    expect(isPinHash(hashPassword("a-proper-long-passphrase"))).toBe(false);
    expect(pin.split("$")).toHaveLength(3);
  });

  it("checks the right password and refuses the wrong ones", () => {
    const pin = hashPin("4821", SECRET);
    expect(verifyPassword("4821", pin, SECRET)).toBe(true);
    for (const wrong of ["4822", "0000", "", "48210", "4821 "]) expect(verifyPassword(wrong, pin, SECRET)).toBe(false);
  });

  it("is salted: the same password gives a different hash each time, and each still checks", () => {
    const a = hashPin("4821", SECRET);
    const b = hashPin("4821", SECRET);
    expect(a).not.toBe(b);
    expect(verifyPassword("4821", a, SECRET) && verifyPassword("4821", b, SECRET)).toBe(true);
  });

  it("needs the server's key: without it, or with another, nothing checks, so the database alone is not enough to crack it", () => {
    const pin = hashPin("4821", SECRET);
    expect(verifyPassword("4821", pin)).toBe(false);
    expect(verifyPassword("4821", pin, "another-secret-entirely")).toBe(false);
    expect(verifyPassword("4821", pin, "")).toBe(false);
  });

  it("is never offered for replacement the way a weaker strong hash is", () => {
    expect(needsRehash(hashPin("4821", SECRET))).toBe(false);
  });

  it("never throws on a damaged stored value", () => {
    for (const bad of ["pin1$", "pin1$x", "pin1$%%%$%%%", "pin1$a$b$c", "pin2$AAAA$AAAA"]) expect(verifyPassword("4821", bad, SECRET)).toBe(false);
  });

  it("leaves the strong hash exactly as it was: a passphrase still checks, with or without a key", () => {
    const strong = hashPassword("a-proper-long-passphrase");
    expect(verifyPassword("a-proper-long-passphrase", strong)).toBe(true);
    expect(verifyPassword("a-proper-long-passphrase", strong, SECRET)).toBe(true);
    expect(verifyPassword("nope", strong, SECRET)).toBe(false);
  });

  it("is quick: a thousand checks take well under a second, where the strong hash takes about a third of a second each", () => {
    const pin = hashPin("4821", SECRET);
    const start = performance.now();
    for (let i = 0; i < 1000; i++) verifyPassword("0000", pin, SECRET);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
