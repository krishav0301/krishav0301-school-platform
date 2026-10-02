/**
 * The People & Access screen's two lists (D-099): the administrative staff the Principal gives access to
 * (Co-ordinators and Accountants), and the teaching staff, whom Co-ordinators manage. Filtered, searched and paged in
 * the database, with the three counts and the sections, in one round trip. Carries no password or hash.
 *
 * Who sees what is the same as the staff list (`listStaff`): an Admin or Super Admin sees both lists; a Co-ordinator
 * sees only teachers, and only their own sections' if their scope is limited; nobody else sees anyone. A teacher's
 * subjects and programmes come from `academics` as SQL fragments, so this module never names its tables.
 */
import { teacherProgrammesJson, teacherSubjectsJson, teachesInProgramme } from "../academics";
import type { RoleClaim } from "../../core/tokens";
import { actorMayManage } from "./guard";
import type { PeopleList, PeopleQuery, Person } from "./staff-schema";

export const PEOPLE_PAGE_SIZE = 10;

interface Row {
  public_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  is_active: number;
  must_change_password: number;
  last_login_at: string | null;
  role: "coordinator" | "accountant" | "teacher";
  sections_json: string;
  home_key: string | null;
  home_name: string | null;
  subjects_json: string | null;
  programmes_json: string | null;
  added_by_name: string | null;
  added_by_role: string | null;
  added_by_support: number | null;
  can_manage: number;
}

/** "%text%" for LIKE, with the wildcards in the text itself made literal (escape character "\"). */
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

/** Who the viewer may see in each list, from their sign-in roles (the same rules as `listStaff`). */
function visibility(viewer: readonly RoleClaim[]) {
  const isAdmin = viewer.some((r) => r.role === "admin" || r.role === "super_admin");
  const isCoordinator = viewer.some((r) => r.role === "coordinator");
  const wholeSchool = isAdmin || viewer.some((r) => r.role === "coordinator" && r.scope === "institution");
  const sections = wholeSchool ? null : viewer.filter((r) => r.role === "coordinator" && r.scope === "section" && r.section).map((r) => r.section!);
  return { admin: isAdmin, teaching: isAdmin || isCoordinator, teacherSections: sections };
}

export async function listPeople(db: D1Database, viewer: readonly RoleClaim[], viewerPublicId: string, query: PeopleQuery): Promise<PeopleList> {
  const see = visibility(viewer);
  const pageSize = Math.max(1, Math.min(query.pageSize ?? PEOPLE_PAGE_SIZE, 50));
  const page = Math.max(1, query.page ?? 1);
  const allowed = query.group === "admin" ? see.admin : see.teaching;
  const roles = query.group === "admin" ? (query.role ? [query.role] : ["coordinator", "accountant"]) : ["teacher"];
  const q = query.q?.trim() ? likePattern(query.q.trim()) : null;
  const status = query.status === "active" ? 1 : query.status === "off" ? 0 : null;

  // ?1 roles, ?2 search, ?3 status, ?4 section, ?5 programme, ?6 the teacher sections a limited Co-ordinator sees,
  // ?7 the viewer's public id, ?8 whether the viewer may see this list at all.
  const where = `WHERE ?8 = 1
      AND EXISTS (SELECT 1 FROM role_assignments fa WHERE fa.user_id = u.id AND fa.is_active = 1 AND fa.role IN (SELECT value FROM json_each(?1)))
      AND NOT EXISTS (SELECT 1 FROM role_assignments fx WHERE fx.user_id = u.id AND fx.role IN ('admin', 'super_admin') AND fx.is_active = 1)
      AND (?2 IS NULL OR u.full_name LIKE ?2 ESCAPE '\\' OR u.email LIKE ?2 ESCAPE '\\')
      AND (?3 IS NULL OR u.is_active = ?3)
      AND (?4 IS NULL OR EXISTS (
            SELECT 1 FROM role_assignments fs LEFT JOIN sections fss ON fss.id = fs.section_id
             WHERE fs.user_id = u.id AND fs.is_active = 1 AND fs.role IN (SELECT value FROM json_each(?1))
               AND (fs.scope_type = 'institution' OR fss.key = ?4))
           OR hs.key = ?4)
      AND (?5 IS NULL OR ${teachesInProgramme("u.id", 5)})
      AND (?6 IS NULL OR hs.key IN (SELECT value FROM json_each(?6)))`;
  const binds = [
    JSON.stringify(roles),
    q,
    status,
    query.section ?? null,
    query.group === "teaching" ? (query.programme ?? null) : null,
    query.group === "teaching" && see.teacherSections !== null ? JSON.stringify(see.teacherSections) : null,
    viewerPublicId,
    allowed ? 1 : 0,
  ];
  const teaching = query.group === "teaching";

  const [list, count, counts, sections] = await db.batch([
    db
      .prepare(
        `SELECT u.public_id, u.full_name, u.email, u.phone, u.is_active, u.must_change_password, u.last_login_at,
                (SELECT ra.role FROM role_assignments ra WHERE ra.user_id = u.id AND ra.is_active = 1 AND ra.role IN (SELECT value FROM json_each(?1)) ORDER BY ra.id LIMIT 1) AS role,
                (SELECT json_group_array(json_object('key', s.key, 'name', s.name)) FROM (
                   SELECT DISTINCT ss.key, ss.name FROM role_assignments rs JOIN sections ss ON ss.id = rs.section_id
                    WHERE rs.user_id = u.id AND rs.is_active = 1 AND rs.scope_type = 'section' ORDER BY ss.name) s) AS sections_json,
                hs.key AS home_key, hs.name AS home_name,
                ${teaching ? teacherSubjectsJson("u.id") : "NULL"} AS subjects_json,
                ${teaching ? teacherProgrammesJson("u.id") : "NULL"} AS programmes_json,
                ab.full_name AS added_by_name,
                (SELECT ar.role FROM role_assignments ar WHERE ar.user_id = ab.id AND ar.is_active = 1 AND ar.role IN ('admin', 'coordinator') ORDER BY ar.id LIMIT 1) AS added_by_role,
                EXISTS (SELECT 1 FROM role_assignments asu WHERE asu.user_id = ab.id AND asu.role = 'super_admin') AS added_by_support,
                ${actorMayManage(7, 9)} AS can_manage
           FROM users u
           LEFT JOIN staff_profiles hp ON hp.user_id = u.id
           LEFT JOIN sections hs ON hs.id = hp.home_section_id
           LEFT JOIN audit_events ae ON ae.id = (
                SELECT MIN(a.id) FROM audit_events a WHERE a.entity_type = 'user' AND a.entity_public_id = u.public_id AND a.action IN ('accounts.staff.created', 'accounts.user.created'))
           LEFT JOIN users ab ON ab.id = ae.actor_user_id
          ${where}
          ORDER BY u.full_name COLLATE NOCASE, u.id
          LIMIT ?10 OFFSET ?11`.replace(/\?9\b/g, "u.public_id"), // `actorMayManage` names its target `?9`: here, each row
      )
      .bind(...binds, null, pageSize, (page - 1) * pageSize),
    db.prepare(`SELECT COUNT(*) AS total FROM users u LEFT JOIN staff_profiles hp ON hp.user_id = u.id LEFT JOIN sections hs ON hs.id = hp.home_section_id ${where}`).bind(...binds),
    db
      .prepare(
        `SELECT
           (SELECT COUNT(DISTINCT u.id) FROM users u JOIN role_assignments r ON r.user_id = u.id AND r.is_active = 1 AND r.role = 'teacher'
              LEFT JOIN staff_profiles hp ON hp.user_id = u.id LEFT JOIN sections hs ON hs.id = hp.home_section_id
             WHERE u.is_active = 1 AND ?3 = 1 AND (?2 IS NULL OR hs.key IN (SELECT value FROM json_each(?2)))) AS teachers,
           (SELECT COUNT(DISTINCT u.id) FROM users u JOIN role_assignments r ON r.user_id = u.id AND r.is_active = 1 AND r.role = 'coordinator'
             WHERE u.is_active = 1 AND ?1 = 1) AS coordinators,
           (SELECT COUNT(DISTINCT u.id) FROM users u JOIN role_assignments r ON r.user_id = u.id AND r.is_active = 1 AND r.role = 'accountant'
             WHERE u.is_active = 1 AND ?1 = 1) AS accountants`,
      )
      .bind(see.admin ? 1 : 0, see.teacherSections === null ? null : JSON.stringify(see.teacherSections), see.teaching ? 1 : 0),
    db.prepare("SELECT key, name, is_active FROM sections ORDER BY name COLLATE NOCASE"),
  ]);

  const parse = (text: string | null): unknown[] => {
    if (!text) return [];
    const value = JSON.parse(text) as unknown;
    return Array.isArray(value) ? value : [];
  };
  const people: Person[] = (list!.results as unknown as Row[]).map((r) => ({
    id: r.public_id,
    fullName: r.full_name,
    email: r.email,
    phone: r.phone,
    role: r.role,
    sections: parse(r.sections_json) as Person["sections"],
    homeSection: r.home_key && r.home_name ? { key: r.home_key, name: r.home_name } : null,
    active: r.is_active === 1,
    mustChangePassword: r.must_change_password === 1,
    lastSignInAt: r.last_login_at,
    subjects: parse(r.subjects_json) as string[],
    programmes: parse(r.programmes_json) as string[],
    addedBy:
      r.added_by_support === 1
        ? { name: null, role: null, support: true }
        : r.added_by_name
          ? { name: r.added_by_name, role: r.added_by_role, support: false }
          : null,
    canManage: r.can_manage === 1,
  }));
  const c = (counts!.results[0] ?? {}) as { teachers?: number; coordinators?: number; accountants?: number };
  return {
    people,
    total: (count!.results[0] as { total: number } | undefined)?.total ?? 0,
    page,
    pageSize,
    counts: { teachers: c.teachers ?? 0, coordinators: c.coordinators ?? 0, accountants: c.accountants ?? 0 },
    sections: (sections!.results as { key: string; name: string; is_active: number }[]).map((s) => ({ key: s.key, name: s.name, active: s.is_active === 1 })),
  };
}
