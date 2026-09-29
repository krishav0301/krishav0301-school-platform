import { recordAudit } from "../../core/audit";
import { CLASS_JOINS, NAMING_COLUMNS, coordinatorFor, naming, sectionInReach, type Reach } from "./guard";
import { SetPicksSchema, type ClassElectives, type SetPicks } from "./schema";

/**
 * Elective picks (D-056, Phase 7 slice 2, D-080): which subjects of an elective group each student takes this year, so
 * a marks grid lists only the students who take its subject. The Co-ordinator records them.
 */

export type Read<T> = { ok: true; data: T } | { ok: false; reason: "not_found" };

/** A class's elective groups and each active student's picks. */
export async function classElectives(db: D1Database, reach: Reach, classId: string): Promise<Read<ClassElectives>> {
  const [cls, groups, students] = await db.batch([
    db.prepare(`SELECT cl.public_id, ${NAMING_COLUMNS} FROM classes cl ${CLASS_JOINS} WHERE cl.public_id = ?1 AND ${sectionInReach(2)}`).bind(classId, reach.institution, reach.sections),
    db
      .prepare(
        `SELECT g.public_id AS group_id, g.name AS group_name, g.pick_count, o.public_id AS offering_id, sb.name AS subject_name
           FROM classes cl JOIN elective_groups g ON g.level_id = cl.level_id AND g.is_active = 1
           JOIN subject_offerings o ON o.elective_group_id = g.id AND o.is_active = 1 JOIN subjects sb ON sb.id = o.subject_id
          WHERE cl.public_id = ?1
          ORDER BY g.id, sb.name`,
      )
      .bind(classId),
    db
      .prepare(
        `SELECT en.public_id AS enrollment_id, st.sid, st.first_name || ' ' || st.last_name AS name,
                (SELECT json_group_array(o.public_id) FROM elective_picks ep JOIN subject_offerings o ON o.id = ep.offering_id
                  WHERE ep.enrollment_id = en.id AND ep.is_active = 1) AS picks
           FROM classes cl JOIN enrollments en ON en.class_id = cl.id AND en.status = 'active' JOIN students st ON st.id = en.student_id
          WHERE cl.public_id = ?1
          ORDER BY en.roll_no, st.first_name, st.last_name`,
      )
      .bind(classId),
  ]);
  const row = cls!.results[0] as { public_id: string; programme_name: string; level_name: string; label: string } | undefined;
  if (!row) return { ok: false, reason: "not_found" };
  const byGroup: ClassElectives["groups"] = [];
  for (const g of groups!.results as unknown as { group_id: string; group_name: string; pick_count: number; offering_id: string; subject_name: string }[]) {
    let group = byGroup[byGroup.length - 1];
    if (!group || group.id !== g.group_id) byGroup.push((group = { id: g.group_id, name: g.group_name, pickCount: g.pick_count, subjects: [] }));
    group.subjects.push({ offeringId: g.offering_id, name: g.subject_name });
  }
  return {
    ok: true,
    data: {
      classId: row.public_id,
      ...naming(row),
      groups: byGroup,
      students: (students!.results as unknown as { enrollment_id: string; sid: string; name: string; picks: string }[]).map((s) => ({
        enrollmentId: s.enrollment_id,
        sid: s.sid,
        name: s.name,
        picks: JSON.parse(s.picks) as string[],
      })),
    },
  };
}

export type PickResult = { ok: true } | { ok: false; reason: "not_found" | "year_closed" } | { ok: false; reason: "invalid" | "has_marks"; message: string };

/**
 * Sets one student's picks in one group: exactly the group's pick count, all from the group. A subject the student
 * already has marks in cannot be dropped (its marks would silently leave their results). One batch with its audit entry.
 */
export async function setPicks(db: D1Database, auditKey: string, me: string, enrollmentId: string, groupId: string, input: SetPicks): Promise<PickResult> {
  const parsed = SetPicksSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: parsed.error.issues[0]?.message ?? "That is not valid" };
  const chosen = [...new Set(parsed.data.offeringIds)];

  const [target, options] = await db.batch([
    db
      .prepare(
        `SELECT ay.status AS year_status, g.pick_count, ${coordinatorFor(1, "pv.section_id")} AS allowed
           FROM enrollments en JOIN classes cl ON cl.id = en.class_id JOIN academic_years ay ON ay.id = en.academic_year_id
           JOIN levels lv ON lv.id = cl.level_id JOIN programmes pv ON pv.id = lv.programme_id
           JOIN elective_groups g ON g.level_id = cl.level_id AND g.public_id = ?3 AND g.is_active = 1
          WHERE en.public_id = ?2 AND en.status = 'active'`,
      )
      .bind(me, enrollmentId, groupId),
    db
      .prepare(
        `SELECT o.public_id AS offering_id, sb.name AS subject_name,
                EXISTS (SELECT 1 FROM elective_picks ep WHERE ep.enrollment_id = en.id AND ep.offering_id = o.id AND ep.is_active = 1) AS picked,
                EXISTS (SELECT 1 FROM marks m JOIN mark_sheets ms ON ms.id = m.sheet_id
                         WHERE m.enrollment_id = en.id AND ms.offering_id = o.id AND (m.value_hundredths IS NOT NULL OR m.absent = 1)) AS has_marks
           FROM enrollments en JOIN classes cl ON cl.id = en.class_id
           JOIN elective_groups g ON g.level_id = cl.level_id AND g.public_id = ?2
           JOIN subject_offerings o ON o.elective_group_id = g.id AND o.is_active = 1 JOIN subjects sb ON sb.id = o.subject_id
          WHERE en.public_id = ?1`,
      )
      .bind(enrollmentId, groupId),
  ]);
  const t = target!.results[0] as { year_status: string; pick_count: number; allowed: number } | undefined;
  if (!t || t.allowed !== 1) return { ok: false, reason: "not_found" };
  if (t.year_status === "closed") return { ok: false, reason: "year_closed" };
  const offered = options!.results as unknown as { offering_id: string; subject_name: string; picked: number; has_marks: number }[];
  if (chosen.some((id) => !offered.some((o) => o.offering_id === id))) return { ok: false, reason: "invalid", message: "Choose subjects from this group" };
  if (chosen.length !== t.pick_count) return { ok: false, reason: "invalid", message: `Choose ${t.pick_count} from this group` };
  const dropped = offered.find((o) => o.picked === 1 && o.has_marks === 1 && !chosen.includes(o.offering_id));
  if (dropped) return { ok: false, reason: "has_marks", message: `The student already has marks in ${dropped.subject_name}` };

  const at = new Date().toISOString();
  const scope = `FROM enrollments en JOIN classes cl ON cl.id = en.class_id JOIN levels lv ON lv.id = cl.level_id JOIN programmes pv ON pv.id = lv.programme_id
                 JOIN elective_groups g ON g.level_id = cl.level_id AND g.public_id = ?2
                 JOIN subject_offerings o ON o.elective_group_id = g.id AND o.is_active = 1
                WHERE en.public_id = ?1 AND en.status = 'active' AND ${coordinatorFor(3, "pv.section_id")}`;
  const drop = db
    .prepare(
      `UPDATE elective_picks SET is_active = 0, updated_at = ?5
        WHERE is_active = 1 AND id IN (SELECT ep.id FROM elective_picks ep JOIN subject_offerings o2 ON o2.id = ep.offering_id,
                                        (SELECT en.id AS eid, o.id AS oid ${scope}) sc
                                        WHERE ep.enrollment_id = sc.eid AND ep.offering_id = sc.oid AND o2.public_id NOT IN (SELECT value FROM json_each(?4)))`,
    )
    .bind(enrollmentId, groupId, me, JSON.stringify(chosen), at);
  const pick = db
    .prepare(
      `INSERT INTO elective_picks (enrollment_id, offering_id, is_active, updated_at)
       SELECT en.id, o.id, 1, ?5 ${scope} AND o.public_id IN (SELECT value FROM json_each(?4))
       ON CONFLICT (enrollment_id, offering_id) DO UPDATE SET is_active = 1, updated_at = excluded.updated_at`,
    )
    .bind(enrollmentId, groupId, me, JSON.stringify(chosen), at);
  try {
    const { applied } = await recordAudit(
      db,
      auditKey,
      {
        action: "results.electives.set",
        entityType: "enrollment",
        entityPublicId: enrollmentId,
        actorPublicId: me,
        summary: "Elective picks recorded",
        before: { groupId, picks: offered.filter((o) => o.picked === 1).map((o) => o.offering_id) },
        after: { groupId, picks: chosen },
      },
      [drop, pick],
      { onlyIfLastChanged: true },
    );
    return applied ? { ok: true } : { ok: false, reason: "not_found" };
  } catch (error) {
    if (/academic year is closed/i.test(error instanceof Error ? error.message : String(error))) return { ok: false, reason: "year_closed" };
    throw error;
  }
}
