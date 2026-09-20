import { describe, expect, it } from "vitest";

import { open, seal } from "../src/core/crypto-box";

const key = "test-data-key-0123456789abcdef0123456789abcdef";

describe("sealed values", () => {
  it("open what was sealed", async () => {
    const sealed = await seal(key, "the secret", "outbox");
    expect(await open(key, sealed, "outbox")).toBe("the secret");
  });

  it("do not contain the plain text", async () => {
    const sealed = await seal(key, "JBSWY3DPEHPK3PXP", "totp");
    expect(sealed).not.toContain("JBSWY3DPEHPK3PXP");
    expect(sealed.startsWith("v1.")).toBe(true);
  });

  it("are different every time, even for the same text", async () => {
    expect(await seal(key, "same", "x")).not.toBe(await seal(key, "same", "x"));
  });

  it("handle any text, including Nepali and empty", async () => {
    for (const text of ["", "नमस्ते", "a".repeat(5000), "line\nbreak"]) {
      expect(await open(key, await seal(key, text, "x"), "x")).toBe(text);
    }
  });

  it("cannot be opened with another key", async () => {
    const sealed = await seal(key, "the secret", "x");
    expect(await open("a-different-key-0123456789abcdef0123456789", sealed, "x")).toBeNull();
  });

  it("cannot be opened for another purpose, so a sealed value cannot be moved to where it was not meant to go", async () => {
    const sealed = await seal(key, "the secret", "outbox");
    expect(await open(key, sealed, "totp")).toBeNull();
  });

  it("refuse anything that was tampered with, truncated or is not a sealed value", async () => {
    const sealed = await seal(key, "the secret", "x");
    const [version, iv, body] = sealed.split(".") as [string, string, string];
    const flipped = body.slice(0, -2) + (body.endsWith("AA") ? "BB" : "AA");
    for (const bad of [`${version}.${iv}.${flipped}`, `${version}.${iv}.${body.slice(0, 10)}`, `${version}.${iv}`, "v2.a.b", "", "plain text", `${version}.!!!.${body}`]) {
      expect(await open(key, bad, "x"), bad).toBeNull();
    }
  });

  it("refuse an empty or short key at once, rather than sealing with nothing", async () => {
    await expect(seal("", "x", "x")).rejects.toThrow(/key/i);
    await expect(seal("short", "x", "x")).rejects.toThrow(/key/i);
  });
});
