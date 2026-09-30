import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { createEmailAdapter } from "../src/core/email";
import { app, call, person, seedSections, type Person } from "./academics-helpers";

/**
 * The test mailbox (D-086): on a deployment whose email goes to the "dev" adapter (development and staging; it is
 * refused in production), an Admin can read what the site would have sent, so UAT testers can follow a verification
 * or reset link. Nowhere else: with any other adapter the address does not exist.
 */

let admin: Person, support: Person;

beforeAll(async () => {
  await seedSections();
  admin = await person("admin", "institution");
  support = await person("super_admin", "institution");
  const adapter = createEmailAdapter(env);
  await adapter.send({ to: "first@school.example", subject: "First", body: "Open https://school.example/verify#one", idempotencyKey: "mailbox:1" });
  await adapter.send({ to: "second@school.example", subject: "Second", body: "Open https://school.example/reset#two", idempotencyKey: "mailbox:2" });
});

type Mailbox = { messages: { id: number; at: string; to: string; subject: string; body: string }[] };

describe("the test mailbox", () => {
  it("an Admin and Support read what would have been sent, newest first, links and all", async () => {
    for (const who of [admin, support]) {
      const response = await call("/api/dev/mailbox", { cookie: who.cookie });
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      const { messages } = (await response.json()) as Mailbox;
      const ours = messages.filter((m) => m.to.endsWith("@school.example") && ["First", "Second"].includes(m.subject));
      expect(ours.map((m) => m.subject)).toEqual(["Second", "First"]);
      expect(ours[0]!.body).toContain("https://school.example/reset#two");
    }
  });

  it("nobody else reads it, and signed-out visitors are refused", async () => {
    for (const role of ["coordinator", "accountant", "teacher", "student"] as const) {
      const who = await person(role, role === "student" ? "own" : role === "teacher" ? "assigned" : "institution");
      expect((await call("/api/dev/mailbox", { cookie: who.cookie })).status).toBe(403);
    }
    expect((await call("/api/dev/mailbox")).status).toBe(401);
  });

  it("with any other email adapter it does not exist, even for Support", async () => {
    const response = await app.request(
      "https://school.example/api/dev/mailbox",
      { headers: { "Sec-Fetch-Site": "same-origin", Cookie: support.cookie } },
      { ...env, EMAIL_ADAPTER: "a-real-provider" },
    );
    expect(response.status).toBe(404);
  });
});
