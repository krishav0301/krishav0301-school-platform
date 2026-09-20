import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { renderNumbered } from "../src/core/config/sql-render";

describe("renderNumbered (SQL with ?1, ?2 placeholders, as the services write it)", () => {
  it("puts each value where its number says, and a number can be used more than once", () => {
    expect(renderNumbered("SELECT ?2, ?1, ?1", ["a", 7])).toBe("SELECT 7, 'a', 'a'");
  });

  it("writes text as a quoted literal with quotes doubled, numbers as themselves, and null as NULL", () => {
    expect(renderNumbered("VALUES (?1, ?2, ?3)", ["it's", 3.5, null])).toBe("VALUES ('it''s', 3.5, NULL)");
  });

  it("keeps a value's own spacing, and never re-reads a value as SQL", () => {
    expect(renderNumbered("SELECT ?1", ["a  b ?2 ?1"])).toBe("SELECT 'a  b ?2 ?1'");
    expect(renderNumbered("SELECT ?1, ?2", ["?2", "x"])).toBe("SELECT '?2', 'x'");
  });

  it("refuses a value it cannot write safely on one line", () => {
    expect(() => renderNumbered("SELECT ?1", ["two\nlines"])).toThrow();
    expect(() => renderNumbered("SELECT ?1", ["a\rb"])).toThrow();
    expect(() => renderNumbered("SELECT ?1", ["a\x00b"])).toThrow();
    expect(() => renderNumbered("SELECT ?1", [Number.NaN])).toThrow();
  });

  it("refuses a placeholder with no value, and a plain ? (which is ambiguous with numbered ones)", () => {
    expect(() => renderNumbered("SELECT ?3", ["a"])).toThrow(/no value/i);
    expect(() => renderNumbered("SELECT ?0", ["a"])).toThrow();
    expect(() => renderNumbered("SELECT ?", ["a"])).toThrow(/numbered/i);
  });

  it("leaves a ? inside a quoted SQL string alone, as SQLite does", () => {
    expect(renderNumbered("SELECT 'is it?' AS q, ?1", ["x"])).toBe("SELECT 'is it?' AS q, 'x'");
  });

  it("produces SQL that a real database runs, with hostile text stored as plain text", async () => {
    const hostile = "Robert'); DROP TABLE users;--";
    const sql = renderNumbered("INSERT INTO sections (key, name) VALUES (?1, ?2)", ["render-numbered", hostile]);
    await env.SCRATCH_DB.exec(sql);
    const row = await env.SCRATCH_DB.prepare("SELECT name FROM sections WHERE key = 'render-numbered'").first<{ name: string }>();
    expect(row!.name).toBe(hostile);
    expect((await env.SCRATCH_DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>())!.n).toBeGreaterThanOrEqual(0); // table still there
  });
});
