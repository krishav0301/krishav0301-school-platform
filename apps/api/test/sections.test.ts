import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { verifyAuditChain } from "../src/core/audit";
import { applyPack, parsePack } from "../src/core/config";
import { listProgrammes } from "../src/modules/academics/queries";
import { createProgramme, createSection, renameSection } from "../src/modules/academics/service";
import { createUser } from "../src/modules/accounts/service";
import royalJson from "../../../packs/royal-softech/pack.json";

/** Sections are the Admin's to make (D-095): a school starts with none, like programmes (D-087). */

const db = env.DB;
const key = env.AUDIT_HMAC_KEY;
const people = {} as Record<"admin" | "super_admin" | "coordinator" | "accountant" | "teacher", string>;

const make = async (role: keyof typeof people) =>
  (
    await createUser(db, key, {
      email: `${role}-${crypto.randomUUID().slice(0, 8)}@school.example`,
      password: "blue-river-lamp-2083",
      fullName: `Test ${role}`,
      roles: [{ role, scope: role === "teacher" ? "assigned" : "institution" }],
    })
  ).publicId;

const sectionCount = async () => (await db.prepare("SELECT COUNT(*) AS n FROM sections").first<{ n: number }>())!.n;

beforeAll(async () => {
  await applyPack(db, parsePack(royalJson)); // the school's own pack: no sections
  for (const role of ["admin", "super_admin", "coordinator", "accountant", "teacher"] as const) people[role] = await make(role);
});

describe("a school starts with no sections", () => {
  it("applying its pack adds none", async () => {
    expect(await sectionCount()).toBe(0);
    expect((await listProgrammes(db, "all")).sections).toEqual([]);
  });
});

describe("the Admin makes sections", () => {
  it("adds one, with a generated key that never names the school, and it is audited", async () => {
    const made = await createSection(db, key, people.admin, { name: "  Bachelor's  " });
    expect(made).toMatchObject({ ok: true });
    const sectionKey = (made as { key: string }).key;
    expect(sectionKey).toMatch(/^s[0-9a-f]{10}$/);
    expect((await listProgrammes(db, "all")).sections).toContainEqual({ key: sectionKey, name: "Bachelor's" });

    const audit = await db.prepare("SELECT action, summary FROM audit_events WHERE entity_public_id = ?1").bind(sectionKey).all<{ action: string; summary: string }>();
    expect(audit.results).toEqual([{ action: "academics.section.created", summary: `Section "Bachelor's" added` }]);
    expect((await verifyAuditChain(db, key)).ok).toBe(true);
  });

  it("the Super Admin may too; new sections go last, in the order made", async () => {
    const a = await createSection(db, key, people.super_admin, { name: "Master's" });
    const b = await createSection(db, key, people.admin, { name: "Architecture" });
    const names = (await listProgrammes(db, "all")).sections.map((s) => s.name);
    expect(a.ok && b.ok).toBe(true);
    expect(names.indexOf("Master's")).toBeLessThan(names.indexOf("Architecture"));
  });

  it("no one else may, and nothing is written", async () => {
    const before = await sectionCount();
    for (const who of ["coordinator", "accountant", "teacher"] as const) {
      expect(await createSection(db, key, people[who], { name: `By ${who}` }), who).toEqual({ ok: false, reason: "not_allowed" });
    }
    expect(await sectionCount()).toBe(before);
  });

  it("an Admin switched off since signing in is refused inside the write", async () => {
    const gone = await make("admin");
    await db.prepare("UPDATE users SET is_active = 0 WHERE public_id = ?1").bind(gone).run();
    expect(await createSection(db, key, gone, { name: "Too late" })).toEqual({ ok: false, reason: "not_allowed" });
  });

  it("two sections may not share a name, whatever the capitals; an empty or over-long name is refused", async () => {
    await createSection(db, key, people.admin, { name: "Primary" });
    expect(await createSection(db, key, people.admin, { name: "PRIMARY" })).toEqual({ ok: false, reason: "conflict" });
    expect(await createSection(db, key, people.admin, { name: "   " })).toMatchObject({ ok: false, reason: "invalid" });
    expect(await createSection(db, key, people.admin, { name: "x".repeat(61) })).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("a programme can then be added under the new section", async () => {
    const made = await createSection(db, key, people.admin, { name: "Junior College" });
    const sectionKey = (made as { key: string }).key;
    const programme = await createProgramme(db, key, people.admin, { name: "+2 Science", sectionKey, affiliation: "NEB" });
    expect(programme.ok).toBe(true);
    const listed = (await listProgrammes(db, "all")).programmes.find((p) => p.name === "+2 Science")!;
    expect(listed.section).toEqual({ key: sectionKey, name: "Junior College" });
  });
});

describe("renaming a section", () => {
  it("changes only the name: the key, and the programmes under it, stay; it is audited with before and after", async () => {
    const sectionKey = ((await createSection(db, key, people.admin, { name: "High" })) as { key: string }).key;
    await createProgramme(db, key, people.admin, { name: "Grade 9 to 10", sectionKey, affiliation: "NEB" });

    expect(await renameSection(db, key, people.admin, sectionKey, { name: "High School" })).toEqual({ ok: true });
    const list = await listProgrammes(db, "all");
    expect(list.sections).toContainEqual({ key: sectionKey, name: "High School" });
    expect(list.programmes.find((p) => p.name === "Grade 9 to 10")!.section).toEqual({ key: sectionKey, name: "High School" });

    const last = await db
      .prepare("SELECT action, before_json, after_json FROM audit_events WHERE entity_public_id = ?1 ORDER BY id DESC LIMIT 1")
      .bind(sectionKey)
      .first<{ action: string; before_json: string; after_json: string }>();
    expect(last).toEqual({ action: "academics.section.renamed", before_json: JSON.stringify({ name: "High" }), after_json: JSON.stringify({ name: "High School" }) });
  });

  it("the same name again changes nothing; another section's name is a conflict; an unknown key is not found", async () => {
    const one = ((await createSection(db, key, people.admin, { name: "Evening" })) as { key: string }).key;
    await createSection(db, key, people.admin, { name: "Morning" });
    expect(await renameSection(db, key, people.admin, one, { name: "Evening" })).toEqual({ ok: true });
    expect(await renameSection(db, key, people.admin, one, { name: "morning" })).toEqual({ ok: false, reason: "conflict" });
    expect(await renameSection(db, key, people.admin, "snotthere00", { name: "X" })).toEqual({ ok: false, reason: "not_found" });
  });

  it("only the Admin or the Super Admin may rename", async () => {
    const one = ((await createSection(db, key, people.admin, { name: "Weekend" })) as { key: string }).key;
    for (const who of ["coordinator", "accountant", "teacher"] as const) {
      expect(await renameSection(db, key, people[who], one, { name: `Renamed by ${who}` }), who).toEqual({ ok: false, reason: "not_allowed" });
    }
  });
});

describe("who sees which sections", () => {
  it("a section-scoped person sees only their own section in the list (CLAUDE.md section 5)", async () => {
    const mine = ((await createSection(db, key, people.admin, { name: "Scoped A" })) as { key: string }).key;
    await createSection(db, key, people.admin, { name: "Scoped B" });
    expect((await listProgrammes(db, [mine])).sections).toEqual([{ key: mine, name: "Scoped A" }]);
  });
});
