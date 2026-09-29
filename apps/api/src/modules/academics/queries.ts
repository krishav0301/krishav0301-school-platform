import { adToBsText } from "../../core/dates";
import type { AcademicYearList, Curriculum, ProgrammeList, SchoolClassList, SetupChecklist, SubjectList, Teaching, TerminalList } from "./schema";

/** A section filter for SQL: `null` means every section, otherwise a JSON array of section keys (used with `json_each`). */
const sectionFilter = (sections: "all" | readonly string[]): string | null => (sections === "all" ? null : JSON.stringify(sections));

interface YearRow {
  public_id: string;
  bs_year: number;
  label: string;
  start_date: string;
  end_date: string;
  status: "draft" | "active" | "closed";
}

/** Every year, newest first. One database round trip. */
export async function listYears(db: D1Database): Promise<AcademicYearList> {
  const { results } = await db
    .prepare("SELECT public_id, bs_year, label, start_date, end_date, status FROM academic_years ORDER BY bs_year DESC")
    .all<YearRow>();
  return {
    years: results.map((y) => ({
      id: y.public_id,
      bsYear: y.bs_year,
      label: y.label,
      startDate: y.start_date,
      endDate: y.end_date,
      startDateBs: adToBsText(y.start_date),
      endDateBs: adToBsText(y.end_date),
      status: y.status,
    })),
  };
}

interface ProgrammeRow {
  public_id: string;
  key: string;
  name: string;
  affiliation: string;
  is_active: number;
  grading_policy: "neb_gpa" | "percentage_division" | null;
  section_key: string;
  section_name: string;
  level_id: string | null;
  ordinal: number | null;
  level_name: string | null;
  level_active: number | null;
}

/** The programmes of these sections, each with its levels in order. One database round trip. */
export async function listProgrammes(db: D1Database, sections: "all" | readonly string[]): Promise<ProgrammeList> {
  const { results } = await db
    .prepare(
      `SELECT p.public_id, p.key, p.name, p.affiliation, p.is_active, p.grading_policy, s.key AS section_key, s.name AS section_name,
              l.public_id AS level_id, l.ordinal, l.name AS level_name, l.is_active AS level_active
         FROM programmes p
         JOIN sections s ON s.id = p.section_id
         LEFT JOIN levels l ON l.programme_id = p.id
        WHERE (?1 IS NULL OR s.key IN (SELECT value FROM json_each(?1)))
        ORDER BY p.ordering, p.id, l.ordinal`,
    )
    .bind(sectionFilter(sections))
    .all<ProgrammeRow>();

  const programmes: ProgrammeList["programmes"] = [];
  for (const r of results) {
    let programme = programmes[programmes.length - 1];
    if (!programme || programme.id !== r.public_id) {
      programme = {
        id: r.public_id,
        key: r.key,
        name: r.name,
        section: { key: r.section_key, name: r.section_name },
        affiliation: r.affiliation,
        active: r.is_active === 1,
        gradingPolicy: r.grading_policy,
        levels: [],
      };
      programmes.push(programme);
    }
    if (r.level_id !== null) programme.levels.push({ id: r.level_id, ordinal: r.ordinal!, name: r.level_name!, active: r.level_active === 1 });
  }
  return { programmes };
}

interface ClassRow {
  public_id: string;
  year_id: string;
  programme_id: string;
  programme_name: string;
  section_key: string;
  level_id: string;
  level_name: string;
  label: string;
  is_active: number;
}

/** The classes of these sections, optionally of one year. One database round trip. */
export async function listClasses(db: D1Database, sections: "all" | readonly string[], yearId?: string): Promise<SchoolClassList> {
  const { results } = await db
    .prepare(
      `SELECT c.public_id, y.public_id AS year_id, p.public_id AS programme_id, p.name AS programme_name, s.key AS section_key,
              l.public_id AS level_id, l.name AS level_name, c.label, c.is_active
         FROM classes c
         JOIN academic_years y ON y.id = c.academic_year_id
         JOIN programmes p ON p.id = c.programme_id
         JOIN levels l ON l.id = c.level_id
         JOIN sections s ON s.id = p.section_id
        WHERE (?1 IS NULL OR s.key IN (SELECT value FROM json_each(?1)))
          AND (?2 IS NULL OR y.public_id = ?2)
        ORDER BY y.bs_year DESC, p.ordering, l.ordinal, c.label`,
    )
    .bind(sectionFilter(sections), yearId ?? null)
    .all<ClassRow>();
  return {
    classes: results.map((c) => ({
      id: c.public_id,
      yearId: c.year_id,
      programmeId: c.programme_id,
      programmeName: c.programme_name,
      sectionKey: c.section_key,
      levelId: c.level_id,
      levelName: c.level_name,
      label: c.label,
      active: c.is_active === 1,
    })),
  };
}

interface TerminalRow {
  public_id: string;
  year_id: string;
  name: string;
  ordinal: number;
}

/** The terminals of one year, or of every year. They belong to the whole school, so no section filter. */
export async function listTerminals(db: D1Database, yearId?: string): Promise<TerminalList> {
  const { results } = await db
    .prepare(
      `SELECT t.public_id, y.public_id AS year_id, t.name, t.ordinal
         FROM terminals t JOIN academic_years y ON y.id = t.academic_year_id
        WHERE (?1 IS NULL OR y.public_id = ?1)
        ORDER BY y.bs_year DESC, t.ordinal`,
    )
    .bind(yearId ?? null)
    .all<TerminalRow>();
  return { terminals: results.map((t) => ({ id: t.public_id, yearId: t.year_id, name: t.name, ordinal: t.ordinal })) };
}

interface SubjectRow {
  public_id: string;
  name: string;
  code: string | null;
  is_archived: number;
}

/** The whole catalogue, archived subjects included (they are marked), by name. One database round trip. */
export async function listSubjects(db: D1Database): Promise<SubjectList> {
  const { results } = await db.prepare("SELECT public_id, name, code, is_archived FROM subjects ORDER BY name COLLATE NOCASE").all<SubjectRow>();
  return { subjects: results.map((s) => ({ id: s.public_id, name: s.name, code: s.code, archived: s.is_archived === 1 })) };
}

interface CurriculumRow {
  offering_id: string;
  credit_hundredths: number | null;
  offering_active: number;
  subject_id: string;
  subject_name: string;
  subject_code: string | null;
  is_archived: number;
  group_id: string | null;
  group_name: string | null;
  component_id: string | null;
  component_name: string | null;
  max_hundredths: number | null;
  kind: "theory" | "practical" | null;
  ordinal: number | null;
  component_active: number | null;
}

/**
 * One level's elective groups, subjects and mark components, in one database round trip. Null when the level does not
 * exist or is in a section the person may not see, so a foreign level looks exactly like a missing one.
 */
export async function getCurriculum(db: D1Database, sections: "all" | readonly string[], levelId: string): Promise<Curriculum | null> {
  const [levelResult, groupResult, offeringResult] = await db.batch([
    db
      .prepare(
        `SELECT l.public_id, l.name, p.public_id AS programme_id, p.name AS programme_name
           FROM levels l JOIN programmes p ON p.id = l.programme_id JOIN sections s ON s.id = p.section_id
          WHERE l.public_id = ?1 AND (?2 IS NULL OR s.key IN (SELECT value FROM json_each(?2)))`,
      )
      .bind(levelId, sectionFilter(sections)),
    db
      .prepare(
        `SELECT g.public_id, g.name, g.pick_count, g.is_active
           FROM elective_groups g JOIN levels l ON l.id = g.level_id WHERE l.public_id = ?1 ORDER BY g.id`,
      )
      .bind(levelId),
    db
      .prepare(
        `SELECT o.public_id AS offering_id, o.credit_hundredths, o.is_active AS offering_active,
                s.public_id AS subject_id, s.name AS subject_name, s.code AS subject_code, s.is_archived,
                g.public_id AS group_id, g.name AS group_name,
                c.public_id AS component_id, c.name AS component_name, c.max_hundredths, c.kind, c.ordinal, c.is_active AS component_active
           FROM subject_offerings o
           JOIN levels l ON l.id = o.level_id
           JOIN subjects s ON s.id = o.subject_id
           LEFT JOIN elective_groups g ON g.id = o.elective_group_id
           LEFT JOIN mark_components c ON c.offering_id = o.id
          WHERE l.public_id = ?1
          ORDER BY s.name COLLATE NOCASE, o.id, c.ordinal`,
      )
      .bind(levelId),
  ]);

  const level = levelResult!.results[0] as { public_id: string; name: string; programme_id: string; programme_name: string } | undefined;
  if (!level) return null;

  const offerings: Curriculum["offerings"] = [];
  for (const r of offeringResult!.results as unknown as CurriculumRow[]) {
    let offering = offerings[offerings.length - 1];
    if (!offering || offering.id !== r.offering_id) {
      offering = {
        id: r.offering_id,
        subject: { id: r.subject_id, name: r.subject_name, code: r.subject_code, archived: r.is_archived === 1 },
        creditHundredths: r.credit_hundredths,
        group: r.group_id !== null ? { id: r.group_id, name: r.group_name! } : null,
        active: r.offering_active === 1,
        components: [],
      };
      offerings.push(offering);
    }
    if (r.component_id !== null) {
      offering.components.push({ id: r.component_id, name: r.component_name!, maxHundredths: r.max_hundredths!, kind: r.kind!, ordinal: r.ordinal!, active: r.component_active === 1 });
    }
  }

  return {
    level: { id: level.public_id, name: level.name, programmeId: level.programme_id, programmeName: level.programme_name },
    groups: (groupResult!.results as { public_id: string; name: string; pick_count: number; is_active: number }[]).map((g) => ({
      id: g.public_id,
      name: g.name,
      pickCount: g.pick_count,
      active: g.is_active === 1,
    })),
    offerings,
  };
}

interface TeachingClassRow {
  public_id: string;
  label: string;
  level_name: string;
  ct_id: string | null;
  ct_name: string | null;
}
interface TeachingAssignmentRow {
  offering_id: string;
  subject_name: string;
  teacher_id: string | null;
  teacher_name: string | null;
}
interface TeachingTeacherRow {
  public_id: string;
  full_name: string;
}

/**
 * One class's teaching, in one database round trip: its offerings with their current teacher (or none),
 * its Class Teacher, and the teachers this viewer may pick from (institution-wide sees every teacher;
 * section-scoped sees only their own section's, so the dropdown never offers a teacher the write would
 * then refuse). Null when the class does not exist or is outside the viewer's sections, same as a missing one.
 */
export async function getTeaching(db: D1Database, sections: "all" | readonly string[], classId: string): Promise<Teaching | null> {
  const [classResult, assignmentResult, teacherResult] = await db.batch([
    db
      .prepare(
        `SELECT c.public_id, c.label, l.name AS level_name, tu.public_id AS ct_id, tu.full_name AS ct_name
           FROM classes c
           JOIN levels l ON l.id = c.level_id
           JOIN programmes p ON p.id = l.programme_id
           JOIN sections s ON s.id = p.section_id
           LEFT JOIN users tu ON tu.id = c.class_teacher_user_id
          WHERE c.public_id = ?1 AND (?2 IS NULL OR s.key IN (SELECT value FROM json_each(?2)))`,
      )
      .bind(classId, sectionFilter(sections)),
    db
      .prepare(
        `SELECT o.public_id AS offering_id, s.name AS subject_name, tu.public_id AS teacher_id, tu.full_name AS teacher_name
           FROM subject_offerings o
           JOIN classes c ON c.level_id = o.level_id
           JOIN subjects s ON s.id = o.subject_id
           LEFT JOIN teacher_assignments ta ON ta.class_id = c.id AND ta.offering_id = o.id AND ta.is_active = 1
           LEFT JOIN users tu ON tu.id = ta.teacher_user_id
          WHERE c.public_id = ?1 AND o.is_active = 1
          ORDER BY s.name COLLATE NOCASE`,
      )
      .bind(classId),
    db
      .prepare(
        `SELECT DISTINCT u.public_id, u.full_name
           FROM users u
           JOIN role_assignments ra ON ra.user_id = u.id AND ra.is_active = 1 AND ra.role = 'teacher'
           JOIN classes c ON c.public_id = ?1
           JOIN levels l ON l.id = c.level_id JOIN programmes p ON p.id = l.programme_id
           LEFT JOIN staff_profiles sp ON sp.user_id = u.id
          WHERE u.is_active = 1 AND (?2 = 1 OR sp.home_section_id = p.section_id)
          ORDER BY u.full_name COLLATE NOCASE`,
      )
      .bind(classId, sections === "all" ? 1 : 0),
  ]);

  const cls = classResult!.results[0] as unknown as TeachingClassRow | undefined;
  if (!cls) return null;

  return {
    classId: cls.public_id,
    classLabel: cls.label,
    levelName: cls.level_name,
    classTeacher: cls.ct_id ? { id: cls.ct_id, fullName: cls.ct_name! } : null,
    assignments: (assignmentResult!.results as unknown as TeachingAssignmentRow[]).map((r) => ({
      offeringId: r.offering_id,
      subjectName: r.subject_name,
      teacher: r.teacher_id ? { id: r.teacher_id, fullName: r.teacher_name! } : null,
    })),
    teachers: (teacherResult!.results as unknown as TeachingTeacherRow[]).map((r) => ({ id: r.public_id, fullName: r.full_name })),
  };
}

/**
 * A Co-ordinator's setup checklist (D-062): nothing is stored, this is computed fresh from the data,
 * scoped to the sections the viewer may see. One round trip: each item is a single EXISTS/NOT EXISTS
 * subquery bound to the active year (most items depend on there being one at all).
 */
export async function getSetupChecklist(db: D1Database, sections: "all" | readonly string[]): Promise<SetupChecklist> {
  const filter = sectionFilter(sections);
  const row = await db
    .prepare(
      `SELECT
         EXISTS (SELECT 1 FROM academic_years WHERE status = 'active') AS year,
         EXISTS (SELECT 1 FROM programmes p JOIN sections s ON s.id = p.section_id
                  WHERE p.is_active = 1 AND (?1 IS NULL OR s.key IN (SELECT value FROM json_each(?1)))
                    AND EXISTS (SELECT 1 FROM levels l WHERE l.programme_id = p.id AND l.is_active = 1)) AS structure,
         EXISTS (SELECT 1 FROM classes c JOIN academic_years y ON y.id = c.academic_year_id
                  JOIN programmes p ON p.id = c.programme_id JOIN sections s ON s.id = p.section_id
                  WHERE y.status = 'active' AND c.is_active = 1 AND (?1 IS NULL OR s.key IN (SELECT value FROM json_each(?1)))) AS classes,
         EXISTS (SELECT 1 FROM terminals t JOIN academic_years y ON y.id = t.academic_year_id WHERE y.status = 'active') AS terminals,
         EXISTS (SELECT 1 FROM subject_offerings o JOIN levels l ON l.id = o.level_id JOIN programmes p ON p.id = l.programme_id
                  JOIN sections s ON s.id = p.section_id
                  WHERE o.is_active = 1 AND (?1 IS NULL OR s.key IN (SELECT value FROM json_each(?1)))) AS subjects,
         EXISTS (SELECT 1 FROM users u JOIN role_assignments ra ON ra.user_id = u.id
                  WHERE u.is_active = 1 AND ra.is_active = 1 AND ra.role = 'teacher') AS teachers,
         NOT EXISTS (SELECT 1 FROM classes c JOIN academic_years y ON y.id = c.academic_year_id
                      JOIN programmes p ON p.id = c.programme_id JOIN sections s ON s.id = p.section_id
                      WHERE y.status = 'active' AND c.is_active = 1 AND c.class_teacher_user_id IS NULL
                        AND (?1 IS NULL OR s.key IN (SELECT value FROM json_each(?1))))
                AND EXISTS (SELECT 1 FROM classes c JOIN academic_years y ON y.id = c.academic_year_id
                      JOIN programmes p ON p.id = c.programme_id JOIN sections s ON s.id = p.section_id
                      WHERE y.status = 'active' AND c.is_active = 1 AND (?1 IS NULL OR s.key IN (SELECT value FROM json_each(?1)))) AS classTeachers`,
    )
    .bind(filter)
    .first<Record<string, number>>();
  const r = row!;
  return { year: r.year === 1, structure: r.structure === 1, classes: r.classes === 1, terminals: r.terminals === 1, subjects: r.subjects === 1, teachers: r.teachers === 1, classTeachers: r.classTeachers === 1 };
}
