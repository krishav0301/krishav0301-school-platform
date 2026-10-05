import type { Grant } from "../../core/permissions";
import type { ClassHub, ClassHubList } from "./schema";

/**
 * A class as one page (FUT point 19, D-116). Who opens which class, from the grant: the whole school or some wings (the
 * Principal, the Co-ordinator, Support), or, for a teacher, the classes they teach a subject in and the class they lead
 * as its Class Teacher. Only classes of open (draft or active) terms. Inside a class, the Class Teacher and the staff who
 * reach it see everything; a subject teacher sees the students by name, only their own subjects, and no attendance.
 */

/** The reach as SQL, for a class aliased `cl` whose wing is `s`: `?1` whole school, `?2` wings, `?3` the person, `?4` a teacher's own. */
const IN_REACH = `(?1 = 1 OR s.key IN (SELECT value FROM json_each(?2))
   OR (?4 = 1 AND (cl.class_teacher_user_id = (SELECT id FROM users WHERE public_id = ?3)
       OR EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.class_id = cl.id AND ta.is_active = 1
                   AND ta.teacher_user_id = (SELECT id FROM users WHERE public_id = ?3)))))`;

const reachParams = (grant: Grant, actor: string) => [grant.institution ? 1 : 0, JSON.stringify(grant.sections), actor, grant.assigned ? 1 : 0] as const;

const CLASS_COLUMNS = `cl.public_id AS id, ay.label AS term_label, s.name AS wing, p.name AS course, l.name AS level, cl.label AS section,
        ct.full_name AS class_teacher, ct.public_id AS class_teacher_id,
        (SELECT COUNT(*) FROM enrollments en WHERE en.class_id = cl.id AND en.status = 'active') AS students`;
const CLASS_JOINS = `FROM classes cl
   JOIN academic_years ay ON ay.id = cl.academic_year_id
   JOIN levels l ON l.id = cl.level_id
   JOIN programmes p ON p.id = l.programme_id
   JOIN sections s ON s.id = p.section_id
   LEFT JOIN users ct ON ct.id = cl.class_teacher_user_id`;

interface ClassRow {
  id: string;
  term_label: string;
  wing: string;
  course: string;
  level: string;
  section: string;
  class_teacher: string | null;
  class_teacher_id: string | null;
  students: number;
}

const toClass = (r: ClassRow) => ({
  id: r.id,
  termLabel: r.term_label,
  wing: r.wing,
  course: r.course,
  level: r.level,
  section: r.section,
  classTeacher: r.class_teacher,
  students: r.students,
});

/** The classes a person opens, by wing, course, level and section. One round trip. */
export async function listClassHub(db: D1Database, grant: Grant, actor: string): Promise<ClassHubList> {
  const { results } = await db
    .prepare(
      `SELECT ${CLASS_COLUMNS} ${CLASS_JOINS}
        WHERE ay.status <> 'closed' AND cl.is_active = 1 AND ${IN_REACH}
        ORDER BY s.ordering, p.ordering, l.ordinal, cl.label`,
    )
    .bind(...reachParams(grant, actor))
    .all<ClassRow>();
  return { classes: results.map((r) => ({ ...toClass(r), isClassTeacher: r.class_teacher_id === actor })) };
}

/** One class as its page, or null when it is not one the person opens (the same as a missing class). One round trip. */
export async function getClassHub(db: D1Database, grant: Grant, actor: string, classId: string): Promise<ClassHub | null> {
  const [cls, subjects, mine, terminals, students] = await db.batch([
    db.prepare(`SELECT ${CLASS_COLUMNS} ${CLASS_JOINS} WHERE cl.public_id = ?5 AND ay.status <> 'closed' AND ${IN_REACH}`).bind(...reachParams(grant, actor), classId),
    db
      .prepare(
        `SELECT o.public_id AS offering_id, sb.name FROM classes cl JOIN subject_offerings o ON o.level_id = cl.level_id AND o.is_active = 1
           JOIN subjects sb ON sb.id = o.subject_id WHERE cl.public_id = ?1 ORDER BY sb.name COLLATE NOCASE`,
      )
      .bind(classId),
    db
      .prepare(
        `SELECT o.public_id AS offering_id FROM classes cl JOIN teacher_assignments ta ON ta.class_id = cl.id AND ta.is_active = 1
           JOIN subject_offerings o ON o.id = ta.offering_id
          WHERE cl.public_id = ?1 AND ta.teacher_user_id = (SELECT id FROM users WHERE public_id = ?2)`,
      )
      .bind(classId, actor),
    db
      .prepare(
        `SELECT t.public_id AS id, t.name, EXISTS (SELECT 1 FROM result_publications rp WHERE rp.class_id = cl.id AND rp.terminal_id = t.id) AS published
           FROM classes cl JOIN terminals t ON t.academic_year_id = cl.academic_year_id WHERE cl.public_id = ?1 ORDER BY t.ordinal`,
      )
      .bind(classId),
    db
      .prepare(
        `SELECT en.public_id AS enrollment_id, en.roll_no, st.public_id AS student_id, st.sid,
                trim(st.first_name || ' ' || COALESCE(st.middle_name || ' ', '') || st.last_name) AS name
           FROM classes cl JOIN enrollments en ON en.class_id = cl.id AND en.status = 'active' JOIN students st ON st.id = en.student_id
          WHERE cl.public_id = ?1 ORDER BY en.roll_no IS NULL, en.roll_no, st.first_name, st.last_name`,
      )
      .bind(classId),
  ]);
  const row = cls!.results[0] as unknown as ClassRow | undefined;
  if (!row) return null;

  const isClassTeacher = row.class_teacher_id === actor;
  // Everything of the class: its Class Teacher, and staff who reach it as a whole (not merely by teaching in it).
  const staff = grant.institution || grant.sections.length > 0;
  const seesAll = isClassTeacher || staff;
  const allSubjects = (subjects!.results as { offering_id: string; name: string }[]).map((r) => ({ offeringId: r.offering_id, name: r.name }));
  const taught = new Set((mine!.results as { offering_id: string }[]).map((r) => r.offering_id));
  return {
    class: toClass(row),
    viewer: { seesAll, attendance: seesAll, isClassTeacher, staff },
    subjects: allSubjects,
    mySubjects: seesAll ? allSubjects : allSubjects.filter((s) => taught.has(s.offeringId)),
    // Classwork stays a teacher's own subjects, a Class Teacher's too (the PM, FUT point 19).
    taughtSubjects: allSubjects.filter((s) => taught.has(s.offeringId)),
    terminals: (terminals!.results as { id: string; name: string; published: number }[]).map((r) => ({ id: r.id, name: r.name, published: r.published === 1 })),
    students: (students!.results as { enrollment_id: string; roll_no: number | null; student_id: string; sid: string; name: string }[]).map((r) => ({
      enrollmentId: r.enrollment_id,
      rollNo: r.roll_no,
      name: r.name,
      // A subject teacher sees names only (the PM, FUT point 19).
      sid: seesAll ? r.sid : null,
      studentId: seesAll ? r.student_id : null,
    })),
  };
}
