import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const db = env.DB;
let counter = 0;
const uniq = (prefix: string) => `${prefix}-${++counter}-${crypto.randomUUID().slice(0, 8)}`;

const addUser = async (): Promise<number> =>
  (await db.prepare("INSERT INTO users (public_id, email, password_hash, full_name) VALUES (?1, ?2, 'x', 'Test Teacher')").bind(uniq("pub"), `${uniq("t")}@example.test`).run()).meta.last_row_id;
const addSection = async (): Promise<number> => (await db.prepare("INSERT INTO sections (key, name) VALUES (?1, 'Section')").bind(uniq("sec")).run()).meta.last_row_id;

describe("staff_profiles", () => {
  it("holds a home section for a person", async () => {
    const user = await addUser();
    const section = await addSection();
    await db.prepare("INSERT INTO staff_profiles (user_id, home_section_id) VALUES (?1, ?2)").bind(user, section).run();
    expect(await db.prepare("SELECT home_section_id FROM staff_profiles WHERE user_id = ?1").bind(user).first()).toEqual({ home_section_id: section });
  });

  it("has one row per person", async () => {
    const user = await addUser();
    await db.prepare("INSERT INTO staff_profiles (user_id, home_section_id) VALUES (?1, NULL)").bind(user).run();
    await expect(db.prepare("INSERT INTO staff_profiles (user_id, home_section_id) VALUES (?1, NULL)").bind(user).run()).rejects.toThrow(/UNIQUE|PRIMARY/);
  });

  it("refuses a home section that does not exist, and a person that does not exist", async () => {
    const user = await addUser();
    await expect(db.prepare("INSERT INTO staff_profiles (user_id, home_section_id) VALUES (?1, 999999)").bind(user).run()).rejects.toThrow(/FOREIGN KEY/);
    await expect(db.prepare("INSERT INTO staff_profiles (user_id, home_section_id) VALUES (999999, NULL)").run()).rejects.toThrow(/FOREIGN KEY/);
  });

  it("allows no home section", async () => {
    await db.prepare("INSERT INTO staff_profiles (user_id, home_section_id) VALUES (?1, NULL)").bind(await addUser()).run();
  });
});
