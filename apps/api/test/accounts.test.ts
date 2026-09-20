import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { verifyPassword } from "../src/core/passwords";
import { WeakPasswordError, createUser } from "../src/modules/accounts/service";

const db = env.DB;
const key = env.AUDIT_HMAC_KEY;
const password = "blue-river-lamp-2083";
let counter = 0;
const uniqueEmail = () => `acct-${++counter}-${crypto.randomUUID().slice(0, 6)}@school.example`;
const count = async (sql: string, ...binds: unknown[]) => (await db.prepare(sql).bind(...binds).first<{ n: number }>())!.n;

describe("creating an account", () => {
  it("saves the user, their roles and an audit entry together", async () => {
    const email = uniqueEmail();
    const { publicId } = await createUser(db, key, {
      email,
      password,
      fullName: "  Sita Sharma  ",
      roles: [{ role: "coordinator", scope: "institution" }],
    });

    const user = await db.prepare("SELECT * FROM users WHERE public_id = ?1").bind(publicId).first<Record<string, unknown>>();
    expect(user).toMatchObject({ email, full_name: "Sita Sharma", is_active: 1 });
    expect(publicId).toMatch(/^[0-9a-f]{32}$/);
    expect(verifyPassword(password, user!.password_hash as string)).toBe(true);
    expect(user!.password_hash).not.toContain(password);

    expect(await count("SELECT COUNT(*) AS n FROM role_assignments WHERE user_id = ?1", user!.id)).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE entity_public_id = ?1 AND action = 'accounts.user.created'", publicId)).toBe(1);
    expect(await verifyAuditChain(db, key)).toMatchObject({ ok: true });
  });

  it("does not put the password, or its hash, in the audit trail", async () => {
    const email = uniqueEmail();
    const { publicId } = await createUser(db, key, { email, password, fullName: "Audit Check", roles: [] });
    const row = await db.prepare("SELECT * FROM audit_events WHERE entity_public_id = ?1").bind(publicId).first();

    expect(JSON.stringify(row)).not.toContain(password);
    expect(JSON.stringify(row)).not.toContain("scrypt$");
  });

  it("stores the email in lower case", async () => {
    const email = uniqueEmail();
    const { publicId } = await createUser(db, key, { email: `  ${email.toUpperCase()} `, password, fullName: "Case", roles: [] });
    const row = await db.prepare("SELECT email FROM users WHERE public_id = ?1").bind(publicId).first<{ email: string }>();
    expect(row!.email).toBe(email);
  });

  it("refuses a weak password before anything is saved", async () => {
    const before = await count("SELECT COUNT(*) AS n FROM users");
    await expect(createUser(db, key, { email: uniqueEmail(), password: "short", fullName: "Weak", roles: [] })).rejects.toThrow(WeakPasswordError);
    expect(await count("SELECT COUNT(*) AS n FROM users")).toBe(before);
  });

  it("refuses a password that contains the person's email name", async () => {
    await expect(
      createUser(db, key, { email: "kamala.thapa@school.example", password: "kamala.thapa-2083", fullName: "K", roles: [] }),
    ).rejects.toMatchObject({ problems: ["contains_email"] });
  });

  it("saves nothing at all when the email is already taken, including the audit entry", async () => {
    const email = uniqueEmail();
    await createUser(db, key, { email, password, fullName: "First", roles: [] });
    const auditBefore = await count("SELECT COUNT(*) AS n FROM audit_events");
    const usersBefore = await count("SELECT COUNT(*) AS n FROM users");

    await expect(createUser(db, key, { email: email.toUpperCase(), password, fullName: "Second", roles: [] })).rejects.toThrow();

    expect(await count("SELECT COUNT(*) AS n FROM audit_events")).toBe(auditBefore);
    expect(await count("SELECT COUNT(*) AS n FROM users")).toBe(usersBefore);
  });

  it("saves nothing when a role is impossible, such as an Admin limited to a section", async () => {
    await db.prepare("INSERT OR IGNORE INTO sections (key, name) VALUES ('bachelors', 'Bachelor''s')").run();
    const email = uniqueEmail();

    await expect(
      createUser(db, key, { email, password, fullName: "Bad Role", roles: [{ role: "admin", scope: "section", sectionKey: "bachelors" }] }),
    ).rejects.toThrow();

    expect(await count("SELECT COUNT(*) AS n FROM users WHERE email = ?1", email)).toBe(0);
  });

  it("saves nothing when a section-scoped role names a section that does not exist", async () => {
    const email = uniqueEmail();
    await expect(
      createUser(db, key, { email, password, fullName: "No Section", roles: [{ role: "accountant", scope: "section", sectionKey: "missing" }] }),
    ).rejects.toThrow();
    expect(await count("SELECT COUNT(*) AS n FROM users WHERE email = ?1", email)).toBe(0);
  });

  it("records who created the account", async () => {
    const admin = await createUser(db, key, { email: uniqueEmail(), password, fullName: "Admin", roles: [{ role: "admin", scope: "institution" }] });
    const adminRow = await db.prepare("SELECT id FROM users WHERE public_id = ?1").bind(admin.publicId).first<{ id: number }>();

    const { publicId } = await createUser(db, key, {
      email: uniqueEmail(), password, fullName: "Made By Admin", roles: [{ role: "teacher", scope: "assigned" }], actorUserId: adminRow!.id,
    });

    const audit = await db.prepare("SELECT actor_user_id FROM audit_events WHERE entity_public_id = ?1").bind(publicId).first<{ actor_user_id: number }>();
    expect(audit!.actor_user_id).toBe(adminRow!.id);
  });
});

describe("createUser and the school's name", () => {
  it("refuses a password built around a word the caller says to avoid, and creates nothing", async () => {
    const before = (await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>())!.n;
    await expect(
      createUser(env.DB, env.AUDIT_HMAC_KEY, {
        email: "name-word@school.example",
        password: "Royal-2083-lamp-xyz",
        fullName: "X",
        roles: [{ role: "student", scope: "own" }],
        avoidWords: ["royal", "softech"],
      }),
    ).rejects.toMatchObject({ problems: ["contains_school_name"] });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>())!.n).toBe(before);
  });
});
