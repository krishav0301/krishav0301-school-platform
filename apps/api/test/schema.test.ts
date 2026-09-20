import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const db = env.DB;
let counter = 0;
const uniq = (prefix: string) => `${prefix}-${++counter}-${crypto.randomUUID().slice(0, 8)}`;

async function addUser(email = `${uniq("user")}@example.test`): Promise<number> {
  const result = await db
    .prepare("INSERT INTO users (public_id, email, password_hash, full_name) VALUES (?1, ?2, 'x', 'Test User')")
    .bind(uniq("pub"), email)
    .run();
  return result.meta.last_row_id;
}

async function addSection(): Promise<number> {
  const result = await db.prepare("INSERT INTO sections (key, name) VALUES (?1, 'Section')").bind(uniq("sec")).run();
  return result.meta.last_row_id;
}

const assign = (userId: number, role: string, scope: string, sectionId: number | null = null) =>
  db
    .prepare("INSERT INTO role_assignments (user_id, role, scope_type, section_id) VALUES (?1, ?2, ?3, ?4)")
    .bind(userId, role, scope, sectionId)
    .run();

describe("school", () => {
  it("allows exactly one row", async () => {
    await db.prepare("INSERT OR IGNORE INTO school (id, name, short_name) VALUES (1, 'A College', 'A')").run();
    await expect(db.prepare("INSERT INTO school (id, name, short_name) VALUES (2, 'B', 'B')").run()).rejects.toThrow();
  });
});

describe("users", () => {
  it("email is unique regardless of letter case", async () => {
    const email = `${uniq("case")}@Example.Test`;
    await addUser(email);
    await expect(addUser(email.toLowerCase())).rejects.toThrow();
  });

  it("refuses a boolean that is not 0 or 1", async () => {
    await expect(
      db
        .prepare("INSERT INTO users (public_id, email, password_hash, full_name, is_active) VALUES (?1, ?2, 'x', 'T', 2)")
        .bind(uniq("pub"), `${uniq("b")}@example.test`)
        .run(),
    ).rejects.toThrow();
  });
});

describe("role assignments: impossible combinations cannot exist", () => {
  it.each([
    ["student", "own"],
    ["teacher", "assigned"],
    ["coordinator", "institution"],
    ["accountant", "institution"],
    ["admin", "institution"],
    ["super_admin", "institution"],
  ])("accepts %s with %s scope", async (role, scope) => {
    const userId = await addUser();
    await expect(assign(userId, role, scope)).resolves.toBeDefined();
  });

  it.each(["coordinator", "accountant"])("a %s may be limited to one section (D-004)", async (role) => {
    const userId = await addUser();
    const sectionId = await addSection();
    await expect(assign(userId, role, "section", sectionId)).resolves.toBeDefined();
  });

  it.each([
    ["student", "institution"],
    ["student", "assigned"],
    ["teacher", "institution"],
    ["admin", "own"],
    ["admin", "assigned"],
    ["super_admin", "own"],
    ["coordinator", "own"],
    ["coordinator", "assigned"],
  ])("refuses %s with %s scope", async (role, scope) => {
    const userId = await addUser();
    await expect(assign(userId, role, scope)).rejects.toThrow();
  });

  it("refuses an Admin limited to a section: Admin is always whole-institution", async () => {
    const userId = await addUser();
    const sectionId = await addSection();
    await expect(assign(userId, "admin", "section", sectionId)).rejects.toThrow();
  });

  it("section scope needs a section, and other scopes must not name one", async () => {
    const userId = await addUser();
    const sectionId = await addSection();
    await expect(assign(userId, "coordinator", "section", null)).rejects.toThrow();
    await expect(assign(userId, "coordinator", "institution", sectionId)).rejects.toThrow();
  });

  it("refuses an unknown role", async () => {
    const userId = await addUser();
    await expect(assign(userId, "principal", "institution")).rejects.toThrow();
  });

  it("refuses the same assignment twice, including the whole-institution case", async () => {
    const userId = await addUser();
    await assign(userId, "coordinator", "institution");
    await expect(assign(userId, "coordinator", "institution")).rejects.toThrow();
  });

  it("allows the same role in two different sections", async () => {
    const userId = await addUser();
    const a = await addSection();
    const b = await addSection();
    await assign(userId, "accountant", "section", a);
    await expect(assign(userId, "accountant", "section", b)).resolves.toBeDefined();
  });

  it("refuses an assignment for a user that does not exist", async () => {
    await expect(assign(999_999_999, "admin", "institution")).rejects.toThrow();
  });
});

describe("outbox", () => {
  it("starts unprocessed", async () => {
    await db
      .prepare("INSERT INTO outbox_events (at, type, payload_json) VALUES (?1, 'test.event', '{}')")
      .bind(new Date().toISOString())
      .run();
    const row = await db
      .prepare("SELECT processed_at, attempts FROM outbox_events WHERE type = 'test.event' LIMIT 1")
      .first<{ processed_at: string | null; attempts: number }>();
    expect(row).toEqual({ processed_at: null, attempts: 0 });
  });
});
