import { adToBsText, nepalDate } from "../../core/dates";
import type { Grant } from "../../core/permissions";
import type { DiscountReport, PriceChangeList } from "./schema";

/**
 * Two reads of the redesign (D-172, slice 6): the Principal's Discounts report (every discount given, so the school sees
 * them in one place) and the Accountant's list of students affected by a price change (net change and what is owed now).
 * Both are read from the ledger and the discount records; nothing is stored for them.
 */

const className = (programme: string, level: string, label: string) => [programme, level, label].filter(Boolean).join(" · ");

export async function discountReport(db: D1Database): Promise<DiscountReport> {
  const { results } = await db
    .prepare(
      `SELECT sd.public_id, st.first_name, st.last_name, st.sid, pv.name AS programme_name, lv.name AS level_name, cl.label,
              sd.amount_paisa, sd.percent, sd.reason_code, sd.note, sd.status, sd.created_at, u.full_name AS given_by
         FROM student_discounts sd JOIN enrollments en ON en.id = sd.enrollment_id JOIN students st ON st.id = en.student_id
         JOIN classes cl ON cl.id = en.class_id JOIN levels lv ON lv.id = cl.level_id JOIN programmes pv ON pv.id = lv.programme_id
         JOIN users u ON u.id = sd.created_by_user_id
        ORDER BY sd.id DESC`,
    )
    .all<{
      public_id: string;
      first_name: string;
      last_name: string;
      sid: string;
      programme_name: string;
      level_name: string;
      label: string;
      amount_paisa: number;
      percent: number | null;
      reason_code: "scholarship" | "sibling" | "staff_child" | "other";
      note: string | null;
      status: "active" | "removed" | "replaced";
      created_at: string;
      given_by: string;
    }>();
  const discounts = results.map((r) => ({
    id: r.public_id,
    studentName: `${r.first_name} ${r.last_name}`,
    sid: r.sid,
    className: className(r.programme_name, r.level_name, r.label),
    amountPaisa: r.amount_paisa,
    percent: r.percent,
    reason: r.reason_code,
    note: r.note,
    status: r.status,
    givenOnBs: adToBsText(nepalDate(new Date(r.created_at))),
    givenBy: r.given_by,
  }));
  const active = discounts.filter((d) => d.status === "active");
  return { discounts, activePaisa: active.reduce((s, d) => s + d.amountPaisa, 0), activeCount: active.length };
}

/**
 * The students whose billing a structure's price changes corrected: each with the net change (negative: they owe less)
 * and what they owe now. Null when the structure is not one the person reaches.
 */
export async function listPriceChanges(db: D1Database, grant: Grant, structureId: string): Promise<PriceChangeList | null> {
  const head = await db
    .prepare("SELECT r.id AS root_id, s.key AS section_key FROM fee_structures v JOIN fee_structures r ON r.id = COALESCE(v.root_id, v.id) JOIN sections s ON s.id = r.section_id WHERE v.public_id = ?1")
    .bind(structureId)
    .first<{ root_id: number; section_key: string }>();
  if (!head || (!grant.institution && !grant.sections.includes(head.section_key))) return null;
  const { results } = await db
    .prepare(
      `SELECT en.public_id AS enrollment_id, st.public_id AS student_id, st.first_name, st.last_name, st.sid, pv.name AS programme_name, lv.name AS level_name, cl.label,
              SUM(le.amount_paisa) AS change_paisa,
              (SELECT COALESCE(SUM(x.amount_paisa), 0) FROM ledger_entries x WHERE x.enrollment_id = en.id) AS balance_paisa,
              EXISTS (SELECT 1 FROM fee_account_closures fc WHERE fc.enrollment_id = en.id) AS closed
         FROM ledger_entries le JOIN enrollments en ON en.id = le.enrollment_id JOIN students st ON st.id = en.student_id
         JOIN classes cl ON cl.id = en.class_id JOIN levels lv ON lv.id = cl.level_id JOIN programmes pv ON pv.id = lv.programme_id
        WHERE ((le.source_type = 'price_change' AND substr(le.source_public_id, 1, 32) IN (SELECT public_id FROM fee_structures WHERE COALESCE(root_id, id) = ?1))
           OR (le.kind = 'charge' AND le.memo LIKE 'Price change:%' AND le.fee_item_id IN (SELECT fi.id FROM fee_items fi JOIN fee_structures v ON v.id = fi.structure_id WHERE COALESCE(v.root_id, v.id) = ?1)))
        GROUP BY en.id HAVING SUM(le.amount_paisa) <> 0
        ORDER BY pv.ordering, lv.ordinal, cl.label, st.last_name, st.first_name`,
    )
    .bind(head.root_id)
    .all<{ enrollment_id: string; student_id: string; first_name: string; last_name: string; sid: string; programme_name: string; level_name: string; label: string; change_paisa: number; balance_paisa: number; closed: number }>();
  return {
    students: results.map((r) => ({
      enrollmentId: r.enrollment_id,
      studentId: r.student_id,
      studentName: `${r.first_name} ${r.last_name}`,
      sid: r.sid,
      className: className(r.programme_name, r.level_name, r.label),
      changePaisa: r.change_paisa,
      balancePaisa: r.balance_paisa,
      closed: r.closed === 1,
    })),
  };
}
