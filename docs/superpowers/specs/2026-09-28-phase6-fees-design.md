# Phase 6: fees and ledger

Status: the PM asked for Phase 6 on 2026-09-28 ("Also take care of phase 6"), after approving Phases 5 and 7 (D-069).
A standing authorisation, as for Phases 4 and 5. Client answers still missing (fee structure, "course-wise",
refund rules): built with the stated defaults (CLAUDE.md section 9), each marked `OPEN:`. No uploads (R2, D-020): a
payment voucher is a bank reference, not a scan. No real gateway (section 9, Phase 9): an interface and a demo adapter.

Rules it rests on: `CLAUDE.md` section 6 "Fees and money" (balance never stored, append-only ledger with triggers and
a hash chain, whole paisa, reversals and refunds as new entries pointing to the original, oldest due first, partial
payments, unique gateway reference, gapless receipts per section and year from a counter in the same batch,
Accountant owns fees, Co-ordinator has no fees view), "Approvals (Admin)" (fee structure, discount, reversal, refund;
approve-and-apply is one batch; stale; never your own), section 9 (discount reasons; every refund needs Admin
approval; gateway: interface and demo only); source 6.4 and 6.5; the matrix's fee rows (pre-scaffolded).

## Slices

| # | Slice | Delivers |
|---|---|---|
| 1 | Ledger core (tests first) | `ledger_entries` with triggers and a keyed hash chain and head (like the audit log), `appendLedger` with retry, `verifyLedgerChain`, balance, oldest-first allocation (property-based tests), receipt counters and receipts |
| 2 | Fee structures and charges | A yearly structure per academic year and programme level (items: one-time, monthly, yearly, whole course), sent for Admin approval through the approvals engine, live and then fixed; charges generated for every enrolled student by the billing-schedule policy, idempotently |
| 3 | Payments and receipts | Cash at the counter (an idempotency key; payment, receipt number and audit in one batch); a student's voucher (bank reference) verified or rejected by the Accountant; the gateway interface, a demo adapter and payment attempts with a unique gateway reference |
| 4 | Discounts, reversals, refunds | Proposed by the Accountant, approved by any Admin (never their own), applied in the approval's own batch; a refund is recorded after approval with how it was paid |
| 5 | Screens, dues, reports, exit | The student's fees and receipts; the Accountant's screens; the dues list and overdue flag; CSV export (Excel-readable; an .xlsx library needs the PM); the exit test for both schools |

## Decisions that shape every slice

1. **One module, `fees`.** It registers its approval kinds with the engine from the composition root, like `content`.
2. **Signs.** `amount_paisa` is a signed whole number of paisa. Positive raises what the student owes (charge, carried
   dues, reversal, refund); negative lowers it (discount, payment). Balance = the sum; positive is due, negative is
   credit. Never stored.
3. **Allocation** is computed, never stored: all credits (payments and discounts, net of reversals and refunds) are
   applied to the charges oldest due date first. What is left on each charge is its due; left on a charge whose due
   date has passed, it is overdue.
4. **The chain.** Each entry stores the previous entry's hash and its own HMAC-SHA256 (the `AUDIT_HMAC_KEY` secret,
   with a "ledger" domain tag). A head row and triggers make a stale link abort the whole batch, which retries, as
   the audit log does. Triggers refuse any update or delete.
5. **Every money write** is one batch: the ledger entries, the receipt counter and receipt when there is one, and the
   audit entry, re-checking the actor's role inside it (D-021). A closed year refuses every entry.
6. **Fee structures are per academic year and programme level** (every class of a level pays the same; "the same for
   every student in a class", source 6.4). `OPEN:` per class if the school needs it.
7. **Billing schedule** (the policy seam, CLAUDE.md section 2): one-time and yearly items are one charge due on the
   year's first day; monthly items are twelve charges, due on the first day of each BS month of the year; a
   whole-course item is one charge in the student's first enrollment in the programme. `OPEN:` the client's real
   schedule and what "course-wise" means.
8. **Receipt numbers**: `<section key>-<BS year>-<5-digit sequence>`, gapless per section and year.
