import { newPublicId } from "../../core/ids";
import { validatePattern } from "../results";
import { coordinatorForInstitution } from "./guard";
import { toTerminal, type TerminalRow } from "./queries";
import { ExamPatternInputSchema, type ExamPattern, type ExamPatternInput } from "./schema";
import { firstMessage, write, type Done } from "./write";

/**
 * The exam pattern (D-117): one per academic term, out of 100, made by the Co-ordinator for a term the Principal
 * created. Every class in the term follows it; a class that needs a different exam goes in a different term. It holds
 * the PM's questions (Grade system? the minimum % for theory and practical; the grade ranges when graded) and the
 * term's terminals with their weights (adding up to 100) and whether each holds the practical. It can change until the
 * first mark is entered in the term; then the database refuses (triggers), and so does this service.
 *
 * The rules themselves (`validatePattern`) live with the calculation in the results module, which owns grading.
 */

/** Marks exist in the term `ay` (an SQL alias): the pattern is locked. */
const LOCKED = (ay: string) => `EXISTS (SELECT 1 FROM mark_sheets ms JOIN terminals lt ON lt.id = ms.terminal_id WHERE lt.academic_year_id = ${ay}.id)`;

/** The term's pattern and terminals, in one round trip. Null when there is no such term. */
export async function getExamPattern(db: D1Database, yearId: string): Promise<ExamPattern | null> {
  const [head, terminals] = await db.batch([
    db
      .prepare(
        `SELECT ay.public_id AS id, ay.label, ay.status, ${LOCKED("ay")} AS locked,
                p.graded, p.theory_min_percent, p.practical_min_percent, p.grade_bands, p.id AS pattern_id
           FROM academic_years ay LEFT JOIN exam_patterns p ON p.academic_year_id = ay.id
          WHERE ay.public_id = ?1`,
      )
      .bind(yearId),
    db
      .prepare(
        `SELECT t.public_id, y.public_id AS year_id, t.name, t.ordinal, t.weight, t.has_practical
           FROM terminals t JOIN academic_years y ON y.id = t.academic_year_id WHERE y.public_id = ?1 ORDER BY t.ordinal`,
      )
      .bind(yearId),
  ]);
  const h = head!.results[0] as
    | { id: string; label: string; status: "draft" | "active" | "closed"; locked: number; graded: number | null; theory_min_percent: number | null; practical_min_percent: number | null; grade_bands: string | null; pattern_id: number | null }
    | undefined;
  if (!h) return null;
  return {
    term: { id: h.id, label: h.label, status: h.status },
    pattern:
      h.pattern_id === null
        ? null
        : {
            graded: h.graded === 1,
            theoryMinPercent: h.theory_min_percent!,
            practicalMinPercent: h.practical_min_percent!,
            gradeBands: h.grade_bands === null ? null : (JSON.parse(h.grade_bands) as { grade: string; from: number }[]),
          },
    terminals: (terminals!.results as unknown as TerminalRow[]).map(toTerminal),
    locked: h.locked === 1,
  };
}

/**
 * Saves the whole pattern at once. The term's terminals are made again from the list, in order, each keeping its id
 * when it has one: nothing refers to a terminal before marks exist, and once they do the pattern is locked. One batch,
 * every statement conditioned on the actor (a whole-school Co-ordinator or the Super Admin), the term not closed and no
 * marks yet; the audit entry is written only if it all applied.
 */
export async function saveExamPattern(db: D1Database, auditKey: string, actor: string, yearId: string, input: ExamPatternInput): Promise<Done> {
  const parsed = ExamPatternInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const p = parsed.data;
  const problem = validatePattern(p);
  if (problem) return { ok: false, reason: "invalid", message: problem };

  const current = await getExamPattern(db, yearId);
  if (!current) return { ok: false, reason: "not_found" };
  if (current.term.status === "closed") return { ok: false, reason: "year_closed" };
  if (current.locked) return { ok: false, reason: "locked" };
  const known = new Set(current.terminals.map((t) => t.id));
  if (p.terminals.some((t) => t.id !== undefined && !known.has(t.id))) return { ok: false, reason: "invalid", message: "A terminal is not one of this term's" };
  if (new Set(p.terminals.filter((t) => t.id).map((t) => t.id)).size !== p.terminals.filter((t) => t.id).length) {
    return { ok: false, reason: "invalid", message: "A terminal is listed twice" };
  }

  const terminals = p.terminals.map((t, i) => ({ id: t.id ?? newPublicId(), name: t.name, weight: t.weight, practical: t.hasPractical ? 1 : 0, ordinal: i + 1 }));
  const bands = p.graded ? JSON.stringify(p.gradeBands!.map((b) => ({ grade: b.grade.trim(), from: b.from }))) : null;
  const at = new Date().toISOString();
  // The condition every statement carries: ?1 the term, ?2 the actor.
  const may = `ay.public_id = ?1 AND ay.status <> 'closed' AND NOT ${LOCKED("ay")} AND ${coordinatorForInstitution(2)}`;

  const outcome = await write(
    db,
    auditKey,
    {
      action: current.pattern ? "academics.exam_pattern.updated" : "academics.exam_pattern.created",
      entityType: "academic_year",
      entityPublicId: yearId,
      actorPublicId: actor,
      summary: `Exam pattern ${current.pattern ? "changed" : "created"} for ${current.term.label}`,
      before: current.pattern ? { ...current.pattern, terminals: current.terminals.map((t) => ({ name: t.name, weight: t.weight, hasPractical: t.hasPractical })) } : undefined,
      after: { graded: p.graded, theoryMinPercent: p.theoryMinPercent, practicalMinPercent: p.practicalMinPercent, gradeBands: p.graded ? p.gradeBands : null, terminals: terminals.map((t) => ({ name: t.name, weight: t.weight, hasPractical: t.practical === 1 })) },
    },
    [
      db.prepare(`DELETE FROM terminals WHERE academic_year_id = (SELECT ay.id FROM academic_years ay WHERE ${may})`).bind(yearId, actor),
      db
        .prepare(
          `INSERT INTO terminals (public_id, academic_year_id, name, ordinal, weight, has_practical)
           SELECT json_extract(j.value, '$.id'), ay.id, json_extract(j.value, '$.name'), json_extract(j.value, '$.ordinal'), json_extract(j.value, '$.weight'), json_extract(j.value, '$.practical')
             FROM academic_years ay JOIN json_each(?3) j
            WHERE ${may}`,
        )
        .bind(yearId, actor, JSON.stringify(terminals)),
      db
        .prepare(
          `INSERT INTO exam_patterns (public_id, academic_year_id, graded, theory_min_percent, practical_min_percent, grade_bands, created_at, updated_at)
           SELECT ?3, ay.id, ?4, ?5, ?6, ?7, ?8, ?8 FROM academic_years ay WHERE ${may}
           ON CONFLICT (academic_year_id) DO UPDATE
             SET graded = excluded.graded, theory_min_percent = excluded.theory_min_percent, practical_min_percent = excluded.practical_min_percent,
                 grade_bands = excluded.grade_bands, updated_at = excluded.updated_at`,
        )
        .bind(yearId, actor, newPublicId(), p.graded ? 1 : 0, p.theoryMinPercent, p.practicalMinPercent, bands, at),
    ],
  );
  if (outcome === "done") return { ok: true };
  if (outcome === "year_closed") return { ok: false, reason: "year_closed" };
  if (outcome === "locked") return { ok: false, reason: "locked" };
  const after = await db.prepare(`SELECT ${coordinatorForInstitution(1)} AS ok`).bind(actor).first<{ ok: number }>();
  if (after?.ok !== 1) return { ok: false, reason: "not_allowed" };
  return { ok: false, reason: "locked" };
}
