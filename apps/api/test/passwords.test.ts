import { describe, expect, it } from "vitest";

import { hashPassword, needsRehash, passwordProblems, verifyPassword } from "../src/core/passwords";

describe("hashing", () => {
  it("stores the algorithm and parameters with the hash", () => {
    expect(hashPassword("a long enough passphrase")).toMatch(/^scrypt\$32768\$8\$1\$[\w-]+\$[\w-]+$/);
  });

  it("verifies the right password and refuses a wrong one", () => {
    const stored = hashPassword("correct horse battery");
    expect(verifyPassword("correct horse battery", stored)).toBe(true);
    expect(verifyPassword("correct horse batterY", stored)).toBe(false);
    expect(verifyPassword("", stored)).toBe(false);
  });

  it("uses a fresh salt: the same password never hashes the same twice", () => {
    expect(hashPassword("same password here")).not.toBe(hashPassword("same password here"));
  });

  it("treats visually identical Unicode as the same password (NFKC)", () => {
    const composed = "café au lait 123"; // é as one character
    const decomposed = "café au lait 123"; // e followed by a combining accent
    expect(verifyPassword(decomposed, hashPassword(composed))).toBe(true);
  });

  it("handles Nepali passwords", () => {
    const stored = hashPassword("नमस्ते संसार १२३४");
    expect(verifyPassword("नमस्ते संसार १२३४", stored)).toBe(true);
    expect(verifyPassword("नमस्ते संसार १२३५", stored)).toBe(false);
  });

  it.each(["", "not-a-hash", "scrypt$abc$8$1$x$y", "scrypt$32768$8$1$onlysalt", "bcrypt$10$x$y$z$w", "scrypt$1$1$1$AAAA$AAAA"])(
    "never throws on a malformed stored hash (%j)",
    (bad) => {
      expect(verifyPassword("anything at all", bad)).toBe(false);
    },
  );

  it("refuses absurd cost parameters in a stored hash instead of running them", () => {
    // A tampered row asking for 2^30 iterations must not be allowed to burn the Worker's CPU.
    expect(verifyPassword("anything", "scrypt$1073741824$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).toBe(false);
  });

  it("flags a hash made with weaker settings for an upgrade", () => {
    expect(needsRehash(hashPassword("current settings ok"))).toBe(false);
    expect(needsRehash("scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).toBe(true);
  });
});

describe("password policy", () => {
  it("accepts a reasonable passphrase", () => {
    expect(passwordProblems("blue-river-lamp-2083")).toEqual([]);
  });

  it("requires at least 10 characters", () => {
    expect(passwordProblems("short1!")).toContain("too_short");
    expect(passwordProblems("exactly-10")).not.toContain("too_short");
  });

  it("counts characters, not bytes, so a Nepali passphrase is not penalised", () => {
    expect(passwordProblems("नमस्ते")).toContain("too_short"); // only 6 code points
    expect(passwordProblems("नमस्ते संसार")).not.toContain("too_short");
  });

  it("caps the length so nobody can submit a megabyte to hash", () => {
    expect(passwordProblems("x".repeat(129))).toContain("too_long");
    expect(passwordProblems("x".repeat(128))).not.toContain("too_long");
  });

  it.each(["password123", "Password123", "1234567890", "qwertyuiop", "nepal12345"])("rejects the common password %s", (common) => {
    expect(passwordProblems(common)).toContain("common");
  });

  it("rejects a password that contains the person's email name", () => {
    expect(passwordProblems("ramesh.sharma-2083", "ramesh.sharma@example.test")).toContain("contains_email");
    expect(passwordProblems("blue-river-lamp-2083", "ramesh.sharma@example.test")).toEqual([]);
  });
});
