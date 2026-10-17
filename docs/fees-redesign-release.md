# Fees redesign: release notes (D-172)

Branch `fees-redesign`, PR #78. Design: `docs/superpowers/specs/2026-10-17-fee-structures-design.md`. Decision: `docs/DECISIONS.md` D-172 and its addenda.

## What changes for people

| Who | What |
|---|---|
| Accountant | Makes a **fee structure** (a name, a wing, start and end dates, priced lines), sends it for approval, links it to levels with no approval. Every student of those levels is charged at once, and a student who joins later is charged too. Asks to **edit** an approved structure (reason; Principal decides; edits a draft copy; sends it again). Sees who a price change affected. Takes payments. **Pays back a credit alone**, up to the credit. Can no longer propose a discount. |
| Principal | Approves structures, edit requests, payment reversals and a student leaving. **Gives discounts alone** (review and confirm; never above the fees); can change or remove one for 15 days, then it is frozen. Reads the **Discounts** report. |
| Co-ordinator | **Mark as left** on a student's record (reason); the Principal decides. Sees no amounts in the request. |
| Student | Sees their statement; a closed account says so and what stays owed. |

## Rules that changed in `CLAUDE.md`

1. Discounts need no approval; they are the Principal's alone.
2. A refund of credit needs no approval; the Accountant does it alone. Payment reversals still need an Admin.
3. **Left** needs the Principal's approval instead of zero dues; on approval the fee account closes for everyone. **Graduated** still needs zero dues.

## Deploy (the PM does this; the agent never runs `wrangler deploy`)

Migrations **0040 to 0043 are not backward compatible** with the old Worker: apply them together with the new Worker, **staging first**.

1. Note the D1 Time Travel bookmark of the database (it restores the last 30 days).
2. Before migrating, look for requests still waiting from the old flow: discount or refund requests that are `pending`, or a refund that is `approved` but not yet `recorded`. Decide them first; the new Worker no longer creates these kinds, and an approved refund can no longer be recorded.
3. `0040_fee_periods.sql` rebuilds `fee_structures` (each old structure becomes a named structure of its term's dates and wing; a live one is linked to its level) and creates `level_fee_structures`.
4. `0041_fee_edits.sql` rebuilds `approval_requests` (new kinds) and creates `fee_edit_requests`.
5. `0042_discounts_by_principal.sql` rebuilds `ledger_entries` keeping every row, id and hash (the hash chain is untouched; verify it after: `verifyLedgerChain`), and creates `student_discounts`.
6. `0043_student_leave.sql` creates `student_leave_requests` and `fee_account_closures` and replaces the ledger rules trigger.
7. Deploy the Worker, then open Fee structures: the old structures show as named structures linked to their levels. Check one student's account before and after: the balances must be identical.
8. Lahan has fees off and is frozen (D-170): do not deploy it as part of this unless the PM asks by name.

## Tests

API 1996 and web 1146 tests pass (the last full run). The exit test `fees-redesign-exit.test.ts` runs the whole flow for Royal Softech and for the Sample Basic School; `fees-structures`, `fees-edit`, `fees-adjustments`, `student-leave` and `fees-reports` cover the parts; the permission tests are updated for the new actions.

## Not done / OPEN

- The Co-ordinator still sees the balance on the promotion board (D-110) though the redesign says they see no amounts.
- Discount reasons are still the default list (Scholarship, Sibling, Staff child, Other); the client's published Dalit-student scholarship may need its own (section 9 of `CLAUDE.md`).
- A reminder email can still go to a student who has left and owes money; whether to stop it is for the PM.
