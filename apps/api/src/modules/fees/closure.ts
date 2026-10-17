/**
 * A student's fee account closes when an approved leave marks them Left (D-172, slice 5). The closure row keeps what was
 * owed at that moment and is never changed or removed; from then on the ledger takes no new entry for that enrollment
 * (migration 0043). This is the one statement the admissions module's approval puts in its batch: it is chained to the
 * statement before it (`changes() > 0`), so it only runs when the student really was marked Left.
 */
export function closeFeeAccountStatement(db: D1Database, args: { enrollmentId: number; leaveRequestId: number; approverPublicId: string; at: string }): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO fee_account_closures (enrollment_id, leave_request_id, closed_at, closed_by_user_id, owed_paisa)
       SELECT ?1, ?2, ?3, u.id, (SELECT COALESCE(SUM(le.amount_paisa), 0) FROM ledger_entries le WHERE le.enrollment_id = ?1)
         FROM users u WHERE u.public_id = ?4 AND changes() > 0`,
    )
    .bind(args.enrollmentId, args.leaveRequestId, args.at, args.approverPublicId);
}
