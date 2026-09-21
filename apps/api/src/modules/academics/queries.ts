import { adToBsText } from "../../core/dates";
import type { AcademicYearList, ProgrammeList, SchoolClassList, TerminalList } from "./schema";

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
      `SELECT p.public_id, p.key, p.name, p.affiliation, p.is_active, s.key AS section_key, s.name AS section_name,
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
      programme = { id: r.public_id, key: r.key, name: r.name, section: { key: r.section_key, name: r.section_name }, affiliation: r.affiliation, active: r.is_active === 1, levels: [] };
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
