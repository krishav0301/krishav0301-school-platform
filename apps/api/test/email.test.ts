import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { createEmailAdapter } from "../src/core/email";
import { validateEnvironment } from "../src/core/environment";

const message = { to: "sita@school.example", subject: "Hello", body: "Body text", idempotencyKey: "test:email:1" };
const stored = async (key: string) =>
  env.DB.prepare("SELECT to_email, subject, body FROM dev_mailbox WHERE idempotency_key = ?1").bind(key).all();

describe("email adapters", () => {
  it("the dev adapter stores the message where development can read it", async () => {
    await createEmailAdapter(env).send(message);
    expect((await stored("test:email:1")).results).toEqual([{ to_email: "sita@school.example", subject: "Hello", body: "Body text" }]);
  });

  it("sending the same key twice stores one message, never two", async () => {
    const adapter = createEmailAdapter(env);
    await adapter.send({ ...message, idempotencyKey: "test:email:2" });
    await adapter.send({ ...message, idempotencyKey: "test:email:2", subject: "Changed" });
    const rows = (await stored("test:email:2")).results;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.subject).toBe("Hello");
  });

  it("an unknown or missing adapter is a loud error, not a silent no-op", () => {
    expect(() => createEmailAdapter({ DB: env.DB, EMAIL_ADAPTER: "carrier-pigeon" })).toThrow(/Unknown EMAIL_ADAPTER/);
    expect(() => createEmailAdapter({ DB: env.DB })).toThrow(/No EMAIL_ADAPTER/);
  });

  it("the dev adapter is refused in production, like demo mode", () => {
    expect(() => validateEnvironment("production", false, "dev")).toThrow(/dev.*production|production.*dev/i);
    expect(() => validateEnvironment("staging", false, "dev")).not.toThrow();
    expect(() => validateEnvironment("development", false, "dev")).not.toThrow();
    expect(() => validateEnvironment("production", false, undefined)).not.toThrow(); // set up later, with the real adapter
  });
});
