import { nepalDate } from "../../core/dates";
import { deviceByKey } from "./devices";
import { ScanInputSchema, type ScanResult } from "./schema";

export interface ScanOptions {
  /** The weekly holiday as a weekday, 0 = Sunday to 6 = Saturday; `null` for none. Saturday unless told otherwise (CLAUDE.md section 6). */
  weeklyHoliday?: number | null;
}

export interface ScanPerson {
  name: string;
  kind: "student" | "staff";
  role: string | null;
  place: string | null;
}

/** What the gate page shows. When a tap is refused before it is recorded, `rejected` says why and `result` is null. */
export interface ScanOutcome {
  result: ScanResult | null;
  person: ScanPerson | null;
  at: string;
  firstAt: string | null;
  rejected?: "bad_key" | "invalid" | "too_old";
  message?: string;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const refused = (rejected: NonNullable<ScanOutcome["rejected"]>, now: Date, message?: string): ScanOutcome => ({ result: null, person: null, at: now.toISOString(), firstAt: null, rejected, ...(message ? { message } : {}) });
const weekdayOf = (day: string): number => new Date(`${day}T00:00:00Z`).getUTCDay();

/** Who a card belongs to, and what is needed to mark them. `?1` is the lookup (a card number or a card id), `?2` the Nepal day of the tap. */
const PERSON_SQL = `
  SELECT r.id AS card_id, r.status AS card_status, r.student_id, r.user_id,
         COALESCE(TRIM(st.first_name || ' ' || COALESCE(st.middle_name || ' ', '') || st.last_name), u.full_name) AS name,
         CASE WHEN r.student_id IS NOT NULL THEN st.status = 'active'
              ELSE u.is_active = 1 AND EXISTS (SELECT 1 FROM role_assignments ra WHERE ra.user_id = u.id AND ra.is_active = 1) END AS owner_active,
         (SELECT ra.role FROM role_assignments ra WHERE ra.user_id = r.user_id AND ra.is_active = 1 ORDER BY ra.role = 'teacher' DESC, ra.id LIMIT 1) AS role,
         EXISTS (SELECT 1 FROM role_assignments ra WHERE ra.user_id = r.user_id AND ra.is_active = 1 AND ra.role = 'teacher') AS is_teacher,
         (SELECT en.id FROM enrollments en JOIN academic_years ay ON ay.id = en.academic_year_id
           WHERE en.student_id = r.student_id AND en.status = 'active' AND ay.status = 'active' ORDER BY en.id DESC LIMIT 1) AS enrollment_id,
         (SELECT pv.name || ' · ' || lv.name || CASE WHEN cl.label <> '' THEN ' · ' || cl.label ELSE '' END
            FROM enrollments en JOIN academic_years ay ON ay.id = en.academic_year_id JOIN classes cl ON cl.id = en.class_id
                 JOIN levels lv ON lv.id = cl.level_id JOIN programmes pv ON pv.id = cl.programme_id
           WHERE en.student_id = r.student_id AND en.status = 'active' AND ay.status = 'active' ORDER BY en.id DESC LIMIT 1) AS place,
         (SELECT x.scanned_at FROM card_scans x
           WHERE x.on_date = ?2 AND x.result IN ('marked', 'recorded')
             AND ((r.student_id IS NOT NULL AND x.student_id = r.student_id) OR (r.user_id IS NOT NULL AND x.user_id = r.user_id))
           ORDER BY x.id LIMIT 1) AS first_at
    FROM rfid_cards r LEFT JOIN students st ON st.id = r.student_id LEFT JOIN users u ON u.id = r.user_id`;

interface PersonRow {
  card_id: number;
  card_status: "active" | "retired";
  student_id: number | null;
  user_id: number | null;
  name: string;
  owner_active: number;
  role: string | null;
  is_teacher: number;
  enrollment_id: number | null;
  place: string | null;
  first_at: string | null;
}

const personOf = (row: PersonRow): ScanPerson => ({ name: row.name, kind: row.student_id !== null ? "student" : "staff", role: row.student_id !== null ? null : row.role, place: row.student_id !== null ? row.place : null });

/**
 * One card tap from a gate computer (D-175). It is recorded as an insert-only scan whatever happens, so there is a trace
 * of every tap; a first tap on a school day also marks the student or teacher Present, as the gate device, in the same
 * batch. The same `scanId` again is the same tap and gets the same answer, so a tap resent after a lost answer, or kept
 * offline and replayed, is never counted twice. The device key is checked again inside the batch.
 *
 * A tap time sent by the gate (kept while offline) is used if it is within a week; one from the future counts as now.
 * Only a tap from today marks attendance (student attendance accepts today only); an earlier day's tap is recorded.
 * The weekly holiday marks nothing. Holidays are not yet in the school's calendar (slice 3).
 */
export async function recordScan(db: D1Database, key: string, input: unknown, now = new Date(), options: ScanOptions = {}): Promise<ScanOutcome> {
  const weeklyHoliday = options.weeklyHoliday === undefined ? 6 : options.weeklyHoliday;
  const device = await deviceByKey(db, key);
  if (!device) return refused("bad_key", now);

  const parsed = ScanInputSchema.safeParse(input);
  if (!parsed.success) return refused("invalid", now, parsed.error.issues[0]?.message ?? "That is not valid");
  const number = parsed.data.cardNumber.toUpperCase();
  const scanId = parsed.data.scanId;

  let tapped = now;
  if (parsed.data.at) {
    tapped = new Date(parsed.data.at);
    if (tapped.getTime() > now.getTime()) tapped = now;
    if (now.getTime() - tapped.getTime() > WEEK_MS) return refused("too_old", now, "That tap is more than a week old");
  }
  const scannedAt = tapped.toISOString();
  const onDate = nepalDate(tapped);
  const today = nepalDate(now);

  const replay = await replayOf(db, device.id, scanId);
  if (replay) return replay;

  const [found, modules] = await db.batch([
    db.prepare(`${PERSON_SQL} WHERE r.card_number = ?1`).bind(number, onDate),
    db.prepare(
      `SELECT COALESCE((SELECT enabled FROM module_switches WHERE key = 'attendance'), 1) AS students_on,
              COALESCE((SELECT enabled FROM module_switches WHERE key = 'teacher_attendance'), 1) AS teachers_on`,
    ),
  ]);
  const card = found!.results[0] as PersonRow | undefined;
  const on = modules!.results[0] as { students_on: number; teachers_on: number };

  let result: ScanResult;
  let mark: "student" | "teacher" | null = null;
  if (!card) result = "unknown";
  else if (card.card_status === "retired") result = "retired";
  else if (!card.owner_active) result = "inactive";
  else if (weeklyHoliday !== null && weekdayOf(onDate) === weeklyHoliday) result = "no_school";
  else if (card.first_at !== null) result = "again";
  else if (card.student_id !== null && on.students_on === 1 && card.enrollment_id !== null && onDate === today) {
    result = "marked";
    mark = "student";
  } else if (card.user_id !== null && card.is_teacher === 1 && on.teachers_on === 1 && onDate === today) {
    result = "marked";
    mark = "teacher";
  } else result = "recorded";

  const received = now.toISOString();
  const statements: D1PreparedStatement[] = [];
  if (mark === "student") {
    statements.push(
      db
        .prepare(
          `INSERT INTO student_attendance (enrollment_id, on_date, status, marked_by_user_id, marked_at, updated_at)
           SELECT ?1, ?2, 'present', g.user_id, ?3, ?3 FROM gate_devices g WHERE g.id = ?4 AND g.status = 'active'
           ON CONFLICT (enrollment_id, on_date) DO UPDATE SET status = 'present', marked_by_user_id = excluded.marked_by_user_id, updated_at = excluded.updated_at`,
        )
        .bind(card!.enrollment_id, onDate, received, device.id),
    );
  } else if (mark === "teacher") {
    statements.push(
      db
        .prepare(
          `INSERT INTO teacher_attendance (user_id, on_date, status, reason, marked_by_user_id, marked_at, updated_at)
           SELECT ?1, ?2, 'present', NULL, g.user_id, ?3, ?3 FROM gate_devices g WHERE g.id = ?4 AND g.status = 'active'
           ON CONFLICT (user_id, on_date) DO UPDATE SET status = 'present', reason = NULL, marked_by_user_id = excluded.marked_by_user_id, updated_at = excluded.updated_at`,
        )
        .bind(card!.user_id, onDate, received, device.id),
    );
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO card_scans (device_id, client_scan_id, card_number, card_id, student_id, user_id, scanned_at, received_at, on_date, result)
         SELECT g.id, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10 FROM gate_devices g WHERE g.id = ?1 AND g.status = 'active'`,
      )
      .bind(device.id, scanId, number, card?.card_id ?? null, card?.student_id ?? null, card?.user_id ?? null, scannedAt, received, onDate, result),
    db.prepare("UPDATE gate_devices SET last_seen_at = ?2 WHERE id = ?1").bind(device.id, received),
  );

  try {
    const results = await db.batch(statements);
    // The scan insert is second to last; if the device was revoked meanwhile it wrote nothing.
    if ((results[results.length - 2]!.meta.changes ?? 0) === 0) return refused("bad_key", now);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/UNIQUE constraint failed: card_scans/i.test(message)) throw error;
    // The same tap got in from another request first: answer as it did.
    const earlier = await replayOf(db, device.id, scanId);
    if (earlier) return earlier;
    throw error;
  }
  return { result, person: card ? personOf(card) : null, at: scannedAt, firstAt: result === "again" ? card!.first_at : null };
}

/** The answer an earlier tap with this id got, rebuilt from what was recorded; null if there was none. */
async function replayOf(db: D1Database, deviceId: number, scanId: string): Promise<ScanOutcome | null> {
  const earlier = await db
    .prepare("SELECT result, scanned_at, on_date, card_id FROM card_scans WHERE device_id = ?1 AND client_scan_id = ?2")
    .bind(deviceId, scanId)
    .first<{ result: ScanResult; scanned_at: string; on_date: string; card_id: number | null }>();
  if (!earlier) return null;
  if (earlier.card_id === null) return { result: earlier.result, person: null, at: earlier.scanned_at, firstAt: null };
  const row = await db.prepare(`${PERSON_SQL} WHERE r.id = ?1`).bind(earlier.card_id, earlier.on_date).first<PersonRow>();
  return { result: earlier.result, person: row ? personOf(row) : null, at: earlier.scanned_at, firstAt: earlier.result === "again" ? row?.first_at ?? null : null };
}
