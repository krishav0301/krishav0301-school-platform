import type { OwnClass } from "./schema";

/**
 * A student's own class (FUT point 18): its wing, course, level and section, the term, the Class Teacher, and every
 * subject with who teaches it. An elective counts only if the student takes it; a group they have not chosen from yet is
 * listed with its choices. Only the signed-in student's current class (the newest enrollment of a term still open), so
 * there is no id to guess. One database round trip.
 */

interface ClassRow {
  term_label: string;
  wing: string;
  course: string;
  level: string;
  section: string;
  class_teacher: string | null;
}

interface SubjectRow {
  name: string;
  group_id: string | null;
  group_name: string | null;
  picked: number;
  teacher: string | null;
}

const MINE = `SELECT en.id FROM enrollments en
                JOIN students st ON st.id = en.student_id
                JOIN academic_years ay ON ay.id = en.academic_year_id
               WHERE st.user_id = (SELECT id FROM users WHERE public_id = ?1) AND en.status = 'active' AND ay.status <> 'closed'
               ORDER BY ay.start_date DESC, en.id DESC LIMIT 1`;

export async function getOwnClass(db: D1Database, userPublicId: string): Promise<OwnClass | null> {
  const [cls, subjects] = await db.batch([
    db
      .prepare(
        `SELECT ay.label AS term_label, s.name AS wing, p.name AS course, l.name AS level, c.label AS section, ct.full_name AS class_teacher
           FROM enrollments en
           JOIN academic_years ay ON ay.id = en.academic_year_id
           JOIN classes c ON c.id = en.class_id
           JOIN levels l ON l.id = c.level_id
           JOIN programmes p ON p.id = l.programme_id
           JOIN sections s ON s.id = p.section_id
           LEFT JOIN users ct ON ct.id = c.class_teacher_user_id
          WHERE en.id = (${MINE})`,
      )
      .bind(userPublicId),
    db
      .prepare(
        `SELECT sb.name, g.public_id AS group_id, g.name AS group_name,
                EXISTS (SELECT 1 FROM elective_picks ep WHERE ep.enrollment_id = en.id AND ep.offering_id = o.id AND ep.is_active = 1) AS picked,
                (SELECT u.full_name FROM teacher_assignments ta JOIN users u ON u.id = ta.teacher_user_id
                  WHERE ta.class_id = c.id AND ta.offering_id = o.id AND ta.is_active = 1 LIMIT 1) AS teacher
           FROM enrollments en
           JOIN classes c ON c.id = en.class_id
           JOIN subject_offerings o ON o.level_id = c.level_id AND o.is_active = 1
           JOIN subjects sb ON sb.id = o.subject_id
           LEFT JOIN elective_groups g ON g.id = o.elective_group_id AND g.is_active = 1
          WHERE en.id = (${MINE}) AND (o.elective_group_id IS NULL OR g.id IS NOT NULL)
          ORDER BY g.id IS NOT NULL, sb.name COLLATE NOCASE`,
      )
      .bind(userPublicId),
  ]);
  const row = cls!.results[0] as unknown as ClassRow | undefined;
  if (!row) return null;

  const rows = subjects!.results as unknown as SubjectRow[];
  const pickedGroups = new Set(rows.filter((r) => r.group_id !== null && r.picked === 1).map((r) => r.group_id));
  const toChoose = new Map<string, { group: string; options: string[] }>();
  for (const r of rows) {
    if (r.group_id === null || pickedGroups.has(r.group_id)) continue;
    (toChoose.get(r.group_id) ?? toChoose.set(r.group_id, { group: r.group_name!, options: [] }).get(r.group_id)!).options.push(r.name);
  }
  return {
    termLabel: row.term_label,
    wing: row.wing,
    course: row.course,
    level: row.level,
    section: row.section,
    classTeacher: row.class_teacher,
    subjects: rows.filter((r) => r.group_id === null || r.picked === 1).map((r) => ({ name: r.name, teacher: r.teacher, elective: r.group_name })),
    electivesToChoose: [...toChoose.values()],
  };
}
