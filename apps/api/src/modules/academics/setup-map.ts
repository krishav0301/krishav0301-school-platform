import type { SetupMap } from "./schema";

/**
 * The whole setup of each open term in one answer (the PM, 2026-10-10): its exam pattern, then Wing > Department >
 * Level, and for each level its subjects and its sections, each section with its Class Teacher, who teaches which
 * subject, and how many students are in it. One database round trip, whatever the size. Only the wings the person
 * reaches. `termId` is one open term, or null for every open one.
 */

const sectionFilter = (sections: "all" | readonly string[]): string | null => (sections === "all" ? null : JSON.stringify(sections));
const IN_REACH = "(?1 IS NULL OR s.key IN (SELECT value FROM json_each(?1)))";
const IN_TERM = "y.status <> 'closed' AND (?2 IS NULL OR y.public_id = ?2)";

type Term = SetupMap["terms"][number];
type Level = Term["wings"][number]["departments"][number]["levels"][number];
type Section = Level["sections"][number];

export async function getSetupMap(db: D1Database, sections: "all" | readonly string[], termId: string | null): Promise<SetupMap> {
  const filter = sectionFilter(sections);
  const [terms, terminals, levels, classes, offerings, teaching] = await db.batch([
    db
      .prepare(
        `SELECT y.public_id AS id, y.label, y.status, p.graded, p.theory_min_percent, p.practical_min_percent, p.id AS pattern_id
           FROM academic_years y LEFT JOIN exam_patterns p ON p.academic_year_id = y.id
          WHERE ${IN_TERM} ORDER BY y.start_date, y.id`,
      )
      .bind(null, termId),
    db
      .prepare(
        `SELECT y.public_id AS term_id, t.name, t.weight, t.has_practical
           FROM terminals t JOIN academic_years y ON y.id = t.academic_year_id WHERE ${IN_TERM} ORDER BY t.ordinal`,
      )
      .bind(null, termId),
    db
      .prepare(
        `SELECT y.public_id AS term_id, s.key AS wing_key, s.name AS wing_name, pv.public_id AS department_id, pv.name AS department_name, l.public_id AS level_id, l.name AS level_name
           FROM term_levels tl
           JOIN academic_years y ON y.id = tl.academic_year_id
           JOIN levels l ON l.id = tl.level_id AND l.is_active = 1
           JOIN programmes pv ON pv.id = l.programme_id AND pv.is_active = 1
           JOIN sections s ON s.id = pv.section_id
          WHERE ${IN_TERM} AND ${IN_REACH}
          ORDER BY s.ordering, s.id, pv.ordering, pv.id, l.ordinal`,
      )
      .bind(filter, termId),
    db
      .prepare(
        `SELECT c.public_id AS id, y.public_id AS term_id, l.public_id AS level_id, c.label, tu.full_name AS class_teacher,
                (SELECT COUNT(*) FROM enrollments e WHERE e.class_id = c.id AND e.status = 'active') AS students
           FROM classes c
           JOIN academic_years y ON y.id = c.academic_year_id
           JOIN levels l ON l.id = c.level_id
           JOIN programmes pv ON pv.id = c.programme_id
           JOIN sections s ON s.id = pv.section_id
           LEFT JOIN users tu ON tu.id = c.class_teacher_user_id
          WHERE c.is_active = 1 AND ${IN_TERM} AND ${IN_REACH}
          ORDER BY l.ordinal, c.label COLLATE NOCASE`,
      )
      .bind(filter, termId),
    db
      .prepare(
        `SELECT y.public_id AS term_id, l.public_id AS level_id, o.public_id AS id, sb.name, o.full_marks_hundredths, o.practical_hundredths, g.name AS group_name
           FROM subject_offerings o
           JOIN levels l ON l.id = o.level_id
           JOIN term_levels tl ON tl.level_id = l.id
           JOIN academic_years y ON y.id = tl.academic_year_id
           JOIN programmes pv ON pv.id = l.programme_id
           JOIN sections s ON s.id = pv.section_id
           JOIN subjects sb ON sb.id = o.subject_id
           LEFT JOIN elective_groups g ON g.id = o.elective_group_id
          WHERE o.is_active = 1 AND ${IN_TERM} AND ${IN_REACH}
          ORDER BY sb.name COLLATE NOCASE`,
      )
      .bind(filter, termId),
    db
      .prepare(
        `SELECT c.public_id AS class_id, o.public_id AS offering_id, tu.full_name AS teacher
           FROM teacher_assignments ta
           JOIN classes c ON c.id = ta.class_id
           JOIN academic_years y ON y.id = c.academic_year_id
           JOIN subject_offerings o ON o.id = ta.offering_id
           JOIN programmes pv ON pv.id = c.programme_id
           JOIN sections s ON s.id = pv.section_id
           JOIN users tu ON tu.id = ta.teacher_user_id
          WHERE ta.is_active = 1 AND c.is_active = 1 AND ${IN_TERM} AND ${IN_REACH}`,
      )
      .bind(filter, termId),
  ]);

  const result: SetupMap = { terms: [] };
  const byTerm = new Map<string, Term>();
  for (const t of terms!.results as unknown as {
    id: string;
    label: string;
    status: Term["status"];
    graded: number | null;
    theory_min_percent: number | null;
    practical_min_percent: number | null;
    pattern_id: number | null;
  }[]) {
    const entry: Term = {
      id: t.id,
      label: t.label,
      status: t.status,
      exam: t.pattern_id === null ? null : { graded: t.graded === 1, theoryMinPercent: t.theory_min_percent!, practicalMinPercent: t.practical_min_percent!, terminals: [] },
      wings: [],
    };
    byTerm.set(t.id, entry);
    result.terms.push(entry);
  }
  for (const t of terminals!.results as unknown as { term_id: string; name: string; weight: number | null; has_practical: number }[]) {
    byTerm.get(t.term_id)?.exam?.terminals.push({ name: t.name, weight: t.weight, hasPractical: t.has_practical === 1 });
  }

  const levelNodes = new Map<string, Level>();
  for (const r of levels!.results as unknown as {
    term_id: string;
    wing_key: string;
    wing_name: string;
    department_id: string;
    department_name: string;
    level_id: string;
    level_name: string;
  }[]) {
    const term = byTerm.get(r.term_id);
    if (!term) continue;
    let wing = term.wings.find((w) => w.key === r.wing_key);
    if (!wing) term.wings.push((wing = { key: r.wing_key, name: r.wing_name, departments: [] }));
    let department = wing.departments.find((d) => d.id === r.department_id);
    if (!department) wing.departments.push((department = { id: r.department_id, name: r.department_name, levels: [] }));
    const node: Level = { id: r.level_id, name: r.level_name, subjects: [], sections: [] };
    department.levels.push(node);
    levelNodes.set(`${r.term_id}:${r.level_id}`, node);
  }
  for (const o of offerings!.results as unknown as {
    term_id: string;
    level_id: string;
    id: string;
    name: string;
    full_marks_hundredths: number;
    practical_hundredths: number | null;
    group_name: string | null;
  }[]) {
    levelNodes.get(`${o.term_id}:${o.level_id}`)?.subjects.push({ id: o.id, name: o.name, fullMarksHundredths: o.full_marks_hundredths, practicalHundredths: o.practical_hundredths, group: o.group_name });
  }
  const sectionNodes = new Map<string, Section>();
  for (const c of classes!.results as unknown as { id: string; term_id: string; level_id: string; label: string; class_teacher: string | null; students: number }[]) {
    const node: Section = { id: c.id, label: c.label, students: c.students, classTeacher: c.class_teacher, teachers: [] };
    levelNodes.get(`${c.term_id}:${c.level_id}`)?.sections.push(node);
    sectionNodes.set(c.id, node);
  }
  for (const a of teaching!.results as unknown as { class_id: string; offering_id: string; teacher: string }[]) {
    sectionNodes.get(a.class_id)?.teachers.push({ subjectId: a.offering_id, teacher: a.teacher });
  }
  return result;
}
