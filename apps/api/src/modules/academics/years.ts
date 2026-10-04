import { adToBs, adToBsText, bsToAd, BS_MONTH_NAMES, daysInMonth } from "../../core/dates";
import { newPublicId } from "../../core/ids";
import { adminForProgrammes } from "./guard";
import { YearChangesSchema, YearInputSchema, type CloseCheck, type NextTerm, type YearChanges, type YearInput } from "./schema";
import { firstMessage, write, type Created, type Done, type Outcome } from "./write";

/**
 * Academic terms (D-109, D-110). A row of `academic_years` is a term of any length: a quarter, a semester, a year. Only
 * the Principal (an Admin, or Support) makes, opens and closes one, and chooses the levels it runs; a level is in only
 * one open term at a time (the database refuses otherwise). Several terms can be open at once.
 */

/** Both days must convert in the verified calendar (D-014). Returns the BS year the term starts in, or a problem. */
function calendarOf(startDate: string, endDate: string): { bsYear: number } | { problem: string } {
  try {
    const start = adToBs(startDate);
    adToBs(endDate);
    return { bsYear: start.year };
  } catch {
    return { problem: "Both days must be inside the verified BS calendar" };
  }
}

/** The words for a term rule the database refused (D-110). */
function refusal(outcome: Outcome): Done | null {
  if (outcome === "level_in_other_term") return { ok: false, reason: "invalid", message: "A level you chose is already in another open term" };
  if (outcome === "level_has_classes") return { ok: false, reason: "invalid", message: "A level you took out has classes in this term; its classes stay, so the level does too" };
  if (outcome === "year_closed") return { ok: false, reason: "year_closed" };
  return null;
}

interface TermRow {
  bs_year: number;
  label: string;
  code: string;
  start_date: string;
  end_date: string;
  status: "draft" | "active" | "closed";
}

/** One round trip: is the person allowed, what is the term now, and do the levels sent all exist and run? */
async function inspect(db: D1Database, publicId: string | null, actor: string, levelIds: readonly string[]) {
  const [allowed, row, levels] = await db.batch([
    db.prepare(`SELECT ${adminForProgrammes(1)} AS ok`).bind(actor),
    db.prepare("SELECT bs_year, label, code, start_date, end_date, status FROM academic_years WHERE public_id = ?1").bind(publicId),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM levels lv JOIN programmes pv ON pv.id = lv.programme_id
          WHERE lv.public_id IN (SELECT value FROM json_each(?1)) AND lv.is_active = 1 AND pv.is_active = 1`,
      )
      .bind(JSON.stringify([...new Set(levelIds)])),
  ]);
  return {
    allowed: (allowed!.results[0] as { ok: number } | undefined)?.ok === 1,
    term: (row!.results[0] as unknown as TermRow | undefined) ?? null,
    levelsKnown: (levels!.results[0] as { n: number }).n === new Set(levelIds).size,
  };
}

/** A receipt code not yet used: the BS year, then the BS year with a letter (2083, 2083B, 2083C ...). */
async function freeCode(db: D1Database, bsYear: number): Promise<string> {
  const { results } = await db.prepare("SELECT code FROM academic_years WHERE code LIKE ?1").bind(`${bsYear}%`).all<{ code: string }>();
  const taken = new Set(results.map((r) => r.code));
  for (const suffix of ["", ..."BCDEFGHIJKLMNOPQRSTUVWXYZ"]) {
    if (!taken.has(`${bsYear}${suffix}`)) return `${bsYear}${suffix}`;
  }
  return `${bsYear}${Date.now().toString(36).toUpperCase().slice(-5)}`;
}

/** Adds the levels to a term, in the same batch as whatever comes before. */
const addLevels = (db: D1Database, termPublicId: string, levelIds: readonly string[]) =>
  db
    .prepare(
      `INSERT INTO term_levels (academic_year_id, level_id)
       SELECT ay.id, lv.id FROM academic_years ay, levels lv
        WHERE ay.public_id = ?1 AND lv.public_id IN (SELECT value FROM json_each(?2))
          AND NOT EXISTS (SELECT 1 FROM term_levels x WHERE x.academic_year_id = ay.id AND x.level_id = lv.id)`,
    )
    .bind(termPublicId, JSON.stringify([...new Set(levelIds)]));

/** Adds a term as a draft, with the levels it runs. */
export async function createYear(db: D1Database, auditKey: string, actor: string, input: YearInput, now: Date = new Date()): Promise<Created> {
  const parsed = YearInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", message: firstMessage(parsed.error) };
  const t = { ...parsed.data, levelIds: parsed.data.levelIds ?? [] };
  const calendar = calendarOf(t.startDate, t.endDate);
  if ("problem" in calendar) return { ok: false, reason: "invalid", message: calendar.problem };
  if (t.bsYear !== undefined && t.bsYear !== calendar.bsYear) return { ok: false, reason: "invalid", message: `The start day is not in BS ${t.bsYear}` };

  const { allowed, levelsKnown } = await inspect(db, null, actor, t.levelIds);
  if (!allowed) return { ok: false, reason: "not_allowed" };
  if (!levelsKnown) return { ok: false, reason: "invalid", message: "Choose levels that exist and are switched on" };

  const label = t.label ?? String(calendar.bsYear);
  const code = t.code ?? (await freeCode(db, calendar.bsYear));
  const publicId = newPublicId();
  const outcome = await write(
    db,
    auditKey,
    {
      action: "academics.year.created",
      entityType: "academic_year",
      entityPublicId: publicId,
      actorPublicId: actor,
      summary: `Academic term ${label} added as a draft`,
      after: { label, code, startDate: t.startDate, endDate: t.endDate, levels: t.levelIds.length },
    },
    [
      db
        .prepare(
          `INSERT INTO academic_years (public_id, bs_year, code, label, start_date, end_date, status, created_at)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, 'draft', ?7 WHERE ${adminForProgrammes(8)}`,
        )
        .bind(publicId, calendar.bsYear, code, label, t.startDate, t.endDate, now.toISOString(), actor),
      addLevels(db, publicId, t.levelIds),
      // The audit entry is written only if the last statement changed a row: the term itself, read back.
      db.prepare("UPDATE academic_years SET status = status WHERE public_id = ?1").bind(publicId),
    ],
  );

  if (outcome === "done") return { ok: true, publicId };
  const refused = refusal(outcome);
  if (refused) return refused as Created;
  if (outcome === "duplicate") return { ok: false, reason: "conflict" }; // the name or the receipt code is taken
  return { ok: false, reason: "not_allowed" };
}

/**
 * Changes a term. The name, receipt code and days only while it is a draft; the levels while it is open, as the whole
 * new set (a level with classes in the term cannot be taken out).
 */
export async function updateYear(db: D1Database, auditKey: string, actor: string, publicId: string, changes: YearChanges): Promise<Done> {
  const parsedChanges = YearChangesSchema.safeParse(changes);
  if (!parsedChanges.success) return { ok: false, reason: "invalid", message: firstMessage(parsedChanges.error) };
  const c = parsedChanges.data;

  const { allowed, term, levelsKnown } = await inspect(db, publicId, actor, c.levelIds ?? []);
  if (!allowed) return { ok: false, reason: "not_allowed" };
  if (!term) return { ok: false, reason: "not_found" };
  if (term.status === "closed") return { ok: false, reason: "year_closed" };
  if (!levelsKnown) return { ok: false, reason: "invalid", message: "Choose levels that exist and are switched on" };

  const before = { label: term.label, code: term.code, startDate: term.start_date, endDate: term.end_date };
  const merged = { label: c.label ?? term.label, code: c.code ?? term.code, startDate: c.startDate ?? term.start_date, endDate: c.endDate ?? term.end_date };
  const detailsChange = JSON.stringify(merged) !== JSON.stringify(before);
  if (detailsChange && term.status !== "draft") return { ok: false, reason: "not_draft" };
  if (merged.endDate <= merged.startDate) return { ok: false, reason: "invalid", message: "The term must end after it starts" };
  const calendar = calendarOf(merged.startDate, merged.endDate);
  if ("problem" in calendar) return { ok: false, reason: "invalid", message: calendar.problem };
  if (!detailsChange && c.levelIds === undefined) return { ok: true }; // nothing to change, nothing to record
  if (merged.code !== term.code) {
    const issued = await db.prepare("SELECT EXISTS (SELECT 1 FROM receipts r JOIN academic_years ay ON ay.id = r.academic_year_id WHERE ay.public_id = ?1) AS n").bind(publicId).first<{ n: number }>();
    if (issued?.n === 1) return { ok: false, reason: "code_locked" }; // receipts already carry the old code
  }

  const statements: D1PreparedStatement[] = [];
  if (c.levelIds !== undefined) {
    statements.push(
      db
        .prepare(
          `DELETE FROM term_levels WHERE academic_year_id = (SELECT id FROM academic_years WHERE public_id = ?1 AND ${adminForProgrammes(3)})
             AND level_id NOT IN (SELECT lv.id FROM levels lv WHERE lv.public_id IN (SELECT value FROM json_each(?2)))`,
        )
        .bind(publicId, JSON.stringify(c.levelIds), actor),
      addLevels(db, publicId, c.levelIds),
    );
  }
  statements.push(
    db
      .prepare(
        `UPDATE academic_years SET label = ?2, code = ?3, start_date = ?4, end_date = ?5, bs_year = ?6
          WHERE public_id = ?1 AND status <> 'closed' AND ${adminForProgrammes(7)}
            AND (code = ?3 OR NOT EXISTS (SELECT 1 FROM receipts r WHERE r.academic_year_id = academic_years.id))`,
      )
      .bind(publicId, merged.label, merged.code, merged.startDate, merged.endDate, calendar.bsYear, actor),
  );

  const outcome = await write(
    db,
    auditKey,
    {
      action: "academics.year.updated",
      entityType: "academic_year",
      entityPublicId: publicId,
      actorPublicId: actor,
      summary: `Academic term ${merged.label} changed`,
      before,
      after: { ...merged, ...(c.levelIds !== undefined ? { levels: c.levelIds.length } : {}) },
    },
    statements,
  );
  if (outcome === "done") return { ok: true };
  const refused = refusal(outcome);
  if (refused) return refused;
  if (outcome === "duplicate") return { ok: false, reason: "conflict" };
  const again = await inspect(db, publicId, actor, []);
  if (!again.allowed) return { ok: false, reason: "not_allowed" };
  return again.term?.status === "closed" ? { ok: false, reason: "year_closed" } : { ok: false, reason: "not_allowed" };
}

/** Opens a draft term. Several terms can be open at once (D-109). */
export async function activateYear(db: D1Database, auditKey: string, actor: string, publicId: string, now: Date = new Date()): Promise<Done> {
  const first = await inspect(db, publicId, actor, []);
  if (!first.allowed) return { ok: false, reason: "not_allowed" };
  if (!first.term) return { ok: false, reason: "not_found" };
  if (first.term.status !== "draft") return { ok: false, reason: "not_draft" };

  const outcome = await write(
    db,
    auditKey,
    {
      action: "academics.year.activated",
      entityType: "academic_year",
      entityPublicId: publicId,
      actorPublicId: actor,
      summary: `Academic term ${first.term.label} opened`,
      before: { status: "draft" },
      after: { status: "active", at: now.toISOString() },
    },
    db.prepare(`UPDATE academic_years SET status = 'active' WHERE public_id = ?1 AND status = 'draft' AND ${adminForProgrammes(2)}`).bind(publicId, actor),
  );
  if (outcome === "done") return { ok: true };
  const second = await inspect(db, publicId, actor, []);
  if (!second.allowed) return { ok: false, reason: "not_allowed" };
  return second.term && second.term.status !== "draft" ? { ok: false, reason: "not_draft" } : { ok: false, reason: "not_allowed" };
}

/**
 * The classes that must be ready before a term closes (D-109): every switched-on class with an active student, and every
 * exam of the term. A class is ready when its results are published for every exam. As SQL over the term `?1`, so the
 * close statement re-checks it inside its own batch: a result unpublished a moment before never slips through.
 */
const MISSING = `SELECT cl.public_id AS class_id, t.public_id AS exam_id, t.name AS exam_name, t.ordinal AS e_order,
                        pv.name || ' · ' || lv.name || CASE WHEN cl.label <> '' THEN ' (' || cl.label || ')' ELSE '' END AS class_name,
                        pv.ordering AS p_order, lv.ordinal AS l_order, cl.label AS c_label
                   FROM academic_years ay JOIN classes cl ON cl.academic_year_id = ay.id AND cl.is_active = 1
                   JOIN levels lv ON lv.id = cl.level_id JOIN programmes pv ON pv.id = lv.programme_id
                   LEFT JOIN terminals t ON t.academic_year_id = ay.id
                  WHERE ay.public_id = ?1
                    AND EXISTS (SELECT 1 FROM enrollments en WHERE en.class_id = cl.id AND en.status = 'active')
                    AND (t.id IS NULL OR NOT EXISTS (SELECT 1 FROM result_publications rp WHERE rp.class_id = cl.id AND rp.terminal_id = t.id))`;

/** What still stops the term from closing. One round trip. */
export async function closeCheck(db: D1Database, publicId: string): Promise<CloseCheck | null> {
  const [head, missing] = await db.batch([
    db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM terminals t WHERE t.academic_year_id = ay.id) AS exams,
                (SELECT COUNT(*) FROM classes cl WHERE cl.academic_year_id = ay.id AND cl.is_active = 1
                    AND EXISTS (SELECT 1 FROM enrollments en WHERE en.class_id = cl.id AND en.status = 'active')) AS classes
           FROM academic_years ay WHERE ay.public_id = ?1`,
      )
      .bind(publicId),
    db.prepare(`${MISSING} ORDER BY p_order, l_order, c_label, e_order`).bind(publicId),
  ]);
  const counts = head!.results[0] as { exams: number; classes: number } | undefined;
  if (!counts) return null;
  const rows = missing!.results as unknown as { class_id: string; class_name: string; exam_id: string | null; exam_name: string | null }[];
  return {
    ready: rows.length === 0,
    exams: counts.exams,
    classes: counts.classes,
    missing: rows.map((r) => ({ classId: r.class_id, className: r.class_name, examId: r.exam_id, examName: r.exam_name })),
  };
}

/** Closes an open term once every class's results are published for every exam (D-109). A closed term refuses every write. */
export async function closeYear(db: D1Database, auditKey: string, actor: string, publicId: string, now: Date = new Date()): Promise<Done | { ok: false; reason: "not_ready"; check: CloseCheck }> {
  const first = await inspect(db, publicId, actor, []);
  if (!first.allowed) return { ok: false, reason: "not_allowed" };
  if (!first.term) return { ok: false, reason: "not_found" };
  if (first.term.status === "closed") return { ok: false, reason: "year_closed" };
  if (first.term.status !== "active") return { ok: false, reason: "invalid", message: "Open the term before closing it" };
  const check = await closeCheck(db, publicId);
  if (check && !check.ready) return { ok: false, reason: "not_ready", check };

  const outcome = await write(
    db,
    auditKey,
    {
      action: "academics.year.closed",
      entityType: "academic_year",
      entityPublicId: publicId,
      actorPublicId: actor,
      summary: `Academic term ${first.term.label} closed`,
      before: { status: "active" },
      after: { status: "closed", at: now.toISOString() },
    },
    db
      .prepare(
        `UPDATE academic_years SET status = 'closed', closed_at = ?2
          WHERE public_id = ?1 AND status = 'active' AND ${adminForProgrammes(3)} AND NOT EXISTS (${MISSING})`,
      )
      .bind(publicId, now.toISOString(), actor),
  );
  if (outcome === "done") return { ok: true };
  const again = await closeCheck(db, publicId);
  if (again && !again.ready) return { ok: false, reason: "not_ready", check: again };
  const after = await inspect(db, publicId, actor, []);
  if (!after.allowed) return { ok: false, reason: "not_allowed" };
  return after.term?.status === "closed" ? { ok: false, reason: "year_closed" } : { ok: false, reason: "not_allowed" };
}

/** The AD day after `ad`. */
const nextDay = (ad: string): string => new Date(Date.parse(`${ad}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const previousDay = (ad: string): string => new Date(Date.parse(`${ad}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** `months` BS months after `startAd`, less a day: Shrawan 1 + 6 months ends Poush's last day. Null outside the verified calendar. */
function endAfterMonths(startAd: string, months: number): string | null {
  try {
    const start = adToBs(startAd);
    const index = start.month - 1 + months;
    const year = start.year + Math.floor(index / 12);
    const month = (index % 12) + 1;
    const day = Math.min(start.day, daysInMonth(year, month));
    return previousDay(bsToAd({ year, month, day }));
  } catch {
    return null;
  }
}

interface ProposedLevel {
  id: string;
  name: string;
  ordinal: number;
  programme_id: string;
  programme_name: string;
  section_key: string;
  usual_months: number | null;
  taken_by: string | null;
}

/**
 * The next term, filled in (D-109): the next level of each batch in this term (a level with students whose programme
 * has a level after it), starting the day after this term ends and running for the longest usual length of those
 * levels (or as long as this term, when none is given). Nothing is created: the Principal confirms or edits it.
 */
export async function proposeNextTerm(db: D1Database, publicId: string): Promise<NextTerm | null> {
  const [termRows, levelRows] = await db.batch([
    db.prepare("SELECT id, bs_year, label, start_date, end_date FROM academic_years WHERE public_id = ?1").bind(publicId),
    db
      .prepare(
        `SELECT nx.public_id AS id, nx.name, nx.ordinal, pv.public_id AS programme_id, pv.name AS programme_name, s.key AS section_key, nx.usual_months,
                (SELECT o.label FROM term_levels otl JOIN academic_years o ON o.id = otl.academic_year_id
                  WHERE otl.level_id = nx.id AND o.status <> 'closed' AND o.public_id <> ?1) AS taken_by
           FROM academic_years ay JOIN term_levels tl ON tl.academic_year_id = ay.id JOIN levels lv ON lv.id = tl.level_id
           JOIN programmes pv ON pv.id = lv.programme_id JOIN sections s ON s.id = pv.section_id
           JOIN levels nx ON nx.programme_id = lv.programme_id AND nx.is_active = 1
                AND nx.ordinal = (SELECT MIN(n2.ordinal) FROM levels n2 WHERE n2.programme_id = lv.programme_id AND n2.is_active = 1 AND n2.ordinal > lv.ordinal)
          WHERE ay.public_id = ?1
            AND EXISTS (SELECT 1 FROM classes cl JOIN enrollments en ON en.class_id = cl.id WHERE cl.academic_year_id = ay.id AND cl.level_id = lv.id)
          ORDER BY s.ordering, pv.ordering, nx.ordinal`,
      )
      .bind(publicId),
  ]);
  const term = termRows!.results[0] as { id: number; bs_year: number; label: string; start_date: string; end_date: string } | undefined;
  if (!term) return null;
  const levels = levelRows!.results as unknown as ProposedLevel[];

  const startDate = nextDay(term.end_date);
  const lengthDays = Math.round((Date.parse(term.end_date) - Date.parse(term.start_date)) / 86_400_000);
  const months = Math.max(0, ...levels.map((l) => l.usual_months ?? 0));
  const sameLength = new Date(Date.parse(`${startDate}T00:00:00Z`) + lengthDays * 86_400_000).toISOString().slice(0, 10);
  const endDate = (months > 0 ? endAfterMonths(startDate, months) : null) ?? sameLength;

  let label = term.label;
  let code = "";
  try {
    const start = adToBs(startDate);
    const programmes = [...new Set(levels.map((l) => l.programme_name))];
    const who = programmes.length === 0 ? "" : programmes.length === 1 ? `${programmes[0]} · ` : `${programmes[0]} +${programmes.length - 1} · `;
    label = `${who}${BS_MONTH_NAMES[start.month - 1]} ${start.year}`;
    code = await freeCode(db, start.year);
  } catch {
    code = await freeCode(db, term.bs_year);
  }

  return {
    label,
    code,
    startDate,
    endDate,
    startDateBs: adToBsText(startDate),
    endDateBs: adToBsText(endDate),
    levels: levels.map((l) => ({
      id: l.id,
      name: l.name,
      ordinal: l.ordinal,
      programmeId: l.programme_id,
      programmeName: l.programme_name,
      sectionKey: l.section_key,
      takenBy: l.taken_by,
    })),
  };
}
