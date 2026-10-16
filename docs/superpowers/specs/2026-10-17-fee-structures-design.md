# Fees: period structures with lines, the Principal's discounts, and refunds of credit

Status: **design for the PM's review (2026-10-17), fourth version; every open question is answered. Nothing is built.** It
replaces how Phase 6 slices 2 to 4 (D-075 to D-077) work. It touches **fees, approvals, permissions, the student
record and the audit log**, and it **changes three fixed rules** (section 7).

Rules it rests on: `CLAUDE.md` section 6 "Fees and money" (balance never stored; append-only ledger with triggers and
a hash chain; whole paisa; corrections are new entries that point back; payments apply to the oldest due first; no late
fees) and "Approvals (Admin)" (approve-and-apply is one batch; a request goes stale if its subject changes; nobody
approves their own request); D-075 to D-078; D-110 (terms); D-137 (fees are a switch).

## 1. The flow, in the PM's words

1. The **Accountant creates a fee structure**: a name, a start date, an end date, and **lines**, each with a price
   (for example Tuition 8,000, Admission 1,500, Exam 500). The lines add up to the **total fees** (10,000).
2. The **Principal approves** the structure. Only an approved structure can be linked.
3. The Accountant **links it to levels**, with no approval. Several levels can share one structure. Every student in
   the classes of a linked level gets the fee **automatically**, and so does a student who joins later.
4. In the student's portal, the fee of 10,000 is there for that period. The student pays 2,000 at the Accountant's
   desk; the Accountant records it and the balance is 8,000. There is no online payment.
5. **A discount** is given only by the Principal, from the student's profile. It is a line below the total that lowers
   the fees. The Principal confirms it first. It can be **edited or removed for 15 days**, then it is **frozen**. It
   can never be more than the fees. The Accountant takes money and records entries; she cannot discount.
6. **A credit** (a student who has paid more than they now owe) is **refunded by the Accountant directly**, up to the
   credit, and the balance returns to zero.
7. **Next year**, the structure is **reused**: the Accountant starts a new period from it (dates and lines already
   filled in, ready to edit), sends it for approval, and links it again. The steps repeat; only the data is prefilled.
8. **Editing an approved structure** needs the Principal: the Accountant requests the edit, the Principal approves the
   request, the Accountant edits, and the Principal approves the structure again. Until then the approved version
   stays in force.
9. **A student who leaves:** the Co-ordinator **requests** that the student be marked **Left**; the **Principal
   approves** it. On approval, in one batch, the student is marked Left and the fee account is **closed, for good**:
   whatever is unpaid **stays as owed on the closed account**, and **no one can change it any more** (no payment,
   discount, refund or charge). Any negotiation (a discount, a refund of a credit, a payment) is done with the
   student **before** the request is approved. A student leaving mid-year gets a Principal discount for the part not
   used, then the Accountant refunds the resulting credit, and only then does the Principal approve the Left request.

## 2. Today, and what changes

| | Today (D-075 to D-077) | New |
|---|---|---|
| A structure | one level, one term; items one-time, monthly, yearly, whole course | a named price list with a date range and plain priced lines |
| Same fees for ten levels | ten structures | one structure linked to ten levels |
| Charges | the Accountant runs "generate charges" | automatic |
| Changing a live structure | not possible | request, approval, edit, approval |
| Next year | a new structure by hand | a new period started from the old one, prefilled |
| Discount | the Accountant proposes, the Principal approves | the Principal gives it directly, editable for 15 days |
| Refund | always the Principal's approval | a credit is refunded by the Accountant alone |
| Student marked Left | the Co-ordinator, only with zero dues | the Co-ordinator requests, the Principal approves; the fee account then closes for good; unpaid stays as owed; nobody can change it |

## 3. Model

**Structure and its periods.** `fee_structures (id, public_id, name, created_by, created_at)`. A structure is the
named price list; each use of it for a period is a **period** `fee_periods (id, structure_id, start_date, end_date,
status, ...)` with `fee_period_lines (id, period_id, name, amount_paisa, is_active)`. A period's status is `draft`,
`waiting`, `live` or `superseded` (see versions below). "Next year" is `startPeriodFrom(period, dates)`: a new period of
the same structure with the old period's lines copied in as a draft. The **total fees** of a period is the sum of its
active lines, never stored.

**Versions (editing).** A live period is fixed. An approved edit request creates a new draft *version* of the period
(a copy). Only a draft version's lines change, and every change bumps its number so a pending approval goes stale. At
most one version of a period is live; the live one stays in force until the new one is approved, when it becomes
`superseded`. Triggers keep what the current ones keep: nothing is deleted (lines are switched off); a live version is
fixed; a closed term's data is never touched.

**Linking.** `level_fee_period (level_id, period_id, linked_by, linked_at)`, one period per level at a time; two periods
of one level may not overlap in dates. Only a period with a live version can be linked, and a level can be linked only
to a period that overlaps a term open for it. Linking and unlinking are audited and need no approval. **Unlinking and
re-linking are blocked once any student under the level has paid anything.** The check is part of the same statement
as the unlink, so a payment arriving at that moment cannot slip past it. After that, fees change only by editing the
period (section 5).

**Charges and the statement.** A charge is a ledger entry for a line of the live version (the existing columns and the
one-charge-per-line-per-student index hold). The **whole total is due on the period's start date** (the PM, 2026-10-17); a
student who joins later is due on the day they join, if that is after the start date. A student's fee statement
reads: lines (their prices) → **total fees** → discount lines (the Principal's, negative) → **net fees** → payments →
**balance**. The balance is the ledger's sum, never stored.

## 4. Automatic charging

`chargeEnrollment(enrollment)` makes every missing charge for one enrollment from the live version of its level's
linked period. It is idempotent. It runs:

1. **When a level is linked:** for every active enrollment in its classes within the period (chunks of 100 per batch).
2. **When someone joins** (admission approval, promotion, a class change): the enrollment's batch also queues a
   `fees.charge_enrollment` event in the outbox (D-034); its handler is idempotent and is retried with backoff.
3. **When a new version goes live:** section 5.
4. **By the 5-minute sweep:** any active enrollment of a linked level with a missing charge is charged. This is the
   safety net, so a charge is never lost because a step failed.

A student who is marked **Left** (section 8) is no longer charged. Fees switched off (D-137) means none of this runs.

## 5. Editing an approved structure

1. **Request.** The Accountant requests an edit with a reason (a new approval kind, `fee_period_edit`). The live
   version stays in force.
2. **The Principal approves the request.** In the same batch a new `draft` version is made, a copy of the live one.
   If declined, nothing changes.
3. **Edit and send.** The Accountant changes the draft's lines and sends it (the existing `fee_structure` approval
   kind, now on the version).
4. **The Principal approves the version.** In one batch: it becomes `live`, the old one `superseded`, and the price
   corrections below are applied. If declined, it returns to draft.

**Price corrections (covered by that approval, no second approval).** For each line in both versions, for each
student charged under the old one:

- **A price goes down:** a `discount` entry for the difference (source `price_change`) on that charge. A student who
  had paid in full shows a **credit**, which the Accountant can refund.
- **A price goes up:** an extra `charge` entry for the difference on every charge of that line, paid or not (the PM).
  It is due on the original day, or on the day the version goes live if that has passed. The student sees the extra
  amount to pay on their own fees page. Its period tag carries the version number, so the one-charge-per-line rule holds.
- **A new line:** charged to every student of the linked levels. **A removed line:** charges already made stay as
  billed (the Principal can discount them); it is not charged again.

The approval's snapshot lists the lines and the effect (students affected, amount credited or added), so the Principal
approves with the figures in front of them.

## 6. The Principal's discount

- **Where:** on the student's fees page, in the Principal's own portal. A discount is a named line (a reason such as
  Scholarship, Sibling, Staff child or Other, and a note) with an amount.
- **Confirm step:** the Principal sees the amount, the student, the fees before and the net fees after, and confirms.
- **Never more than the fees:** the total of a student's discount lines cannot exceed their total fees. The check is
  part of the same statement that writes the entry, so two discounts at once cannot go over.
- **Edit or remove for 15 days:** within 15 calendar days of the discount (Nepal time), the Principal may change its
  amount or remove it. Because the ledger is append-only, a removal is a reversing entry and an edit is a reversal and
  a new discount, both pointing back to the original; the student's statement shows the discount line as it now
  stands, with its history one click away. After 15 days it is **frozen**: the server refuses any change.
- **Only the Principal.** The Accountant cannot give, propose, edit or remove one. There is no request and no
  approval step: the old discount approval kind is retired.
- **Audit and oversight:** every discount, edit and removal is audited with who and when. A Principal-only report lists
  the discounts given (student, amount, reason, date) so the school can see them in one place.

## 7. Rules that change

1. **"Every refund needs the Principal's approval"** (`CLAUDE.md` sections 2 and 9, fixed in the core) becomes: **a
   refund of a credit needs none.** The Accountant records it on a student whose balance shows a credit, for no more
   than that credit, with how it was paid and a reason, as a new `refund` entry in one batch with its audit entry. The
   credit check is in the same statement, so two refunds at once cannot take more than the credit. Because the
   Principal's discount creates the credit when a student leaves, **no other kind of refund is needed, and the refund
   approval kind is retired.** Reversals of a payment (a counter mistake) keep the Principal's approval.
2. **"Discounts need Admin approval"** (section 6, "Approvals") becomes: the Principal gives them directly, with a
   confirm step and a 15-day window. The approval engine then has these kinds: website content, fee structure, fee
   structure edit, payment reversal, and **student leaves** (new, section 8).
3. **"Left or Graduated only with zero dues"** (section 6, "Student and years"): a student can be marked **Left** whatever
   they owe, but only through a **request the Principal approves** (new approval kind, section 8). On approval the
   fee account closes, the unpaid amount stays as owed, and no one can change it. (Graduated at the end of the year
   follows the same closing; to be confirmed when the promotion flow is built.)

Each goes into `DECISIONS.md` as the PM's decision and into `CLAUDE.md`.

## 8. A student who leaves

1. **Request.** The Co-ordinator requests that a student be marked Left, with a reason (a new approval kind,
   `student_leave`). The student stays active, and the fee account stays open, until the Principal decides. The
   Co-ordinator sees no amounts (they have no Fees view, D-078).
2. **The Principal decides.** The request shows the student, their class, the reason, and **their fee statement**: the
   balance still owed or in credit. A Principal who sees a balance can decline, or settle it first. **Decline:** the
   student stays as they were. **Approve:** in one batch the student is marked Left and the fee account is **closed**.
   Nobody approves their own request, and the request goes stale if the student's class or status changes.
3. **Closed means frozen.** No payment, discount (new, edited or removed), refund, reversal or charge can be added by
   anyone. The server refuses it, whoever asks. The statement shows "Closed" with the date and the final balance. A
   balance still owing stays as **owed**; a balance in credit stays as credit.
4. **Negotiate first.** Whatever is agreed with the student (a discount for the part of the year not used, a refund of
   the credit that leaves, a last payment) is done **before** the Principal approves. A student leaving mid-year: the
   Principal discounts the unused part, the Accountant refunds the credit, the balance reaches zero, and the Principal
   approves the request. One who leaves at the year's end is closed as it stands.
5. **A wrong request** is declined by the Principal, which is the safeguard against a mistaken click. Once approved,
   a closed account is closed for everyone: no one, Support included, reopens it.
6. The closing is one entry in the audit log with who requested, who approved, when, and the final balance. It is
   idempotent. Reports and the dues list still show a closed account's owed amount, marked closed.

## 9. Decided by the PM (2026-10-17)

The whole total of a period is due on its start date. A student the Co-ordinator asks to mark Left is marked Left only
when the Principal approves; then the fee account closes and freezes, any unpaid amount stays as owed, and no one can
change it. Negotiations are done before the approval. There are no open questions.

## 10. Permissions

| Action | Who | Approval |
|---|---|---|
| Create a structure and its first period; start a new period from one | Accountant | Principal, to make a period live |
| Request an edit of a live period | Accountant | Principal |
| Link or unlink a level | Accountant | none; blocked once a payment exists |
| Record a payment | Accountant | none |
| **Give, edit or remove a discount** | **Principal** | none; edit or remove within 15 days |
| Refund a credit | Accountant | none; at most the credit |
| Reverse a payment | Accountant asks | Principal |
| Request that a student be marked Left | Co-ordinator | Principal, who sees the fee statement; on approval the fee account closes and freezes |

The Co-ordinator has no fees view. A section-scoped Accountant links and refunds only within their section. The matrix
gets the new rows (`fees.discount.give`, `fees.credit.refund`, `fees.period.link`, `fees.period.edit_request`);
`docs/permission-matrix.md` is regenerated; independent hand-written tests cover them.

## 11. Screens

- **Fees, Structures (Accountant):** a list of structures with their periods (dates, status, levels linked, students
  charged). Create one; open a period: its lines and total, Request edit (or Edit on a draft), Send for approval; "Start
  next period" with the dates to enter.
- **Link to levels:** the levels as the Classes page shows them (a card per department, closed by default, a box per
  level, showing the period a level has now).
- **Price change (Accountant):** after an approved edit, the students now owed money, with the amount.
- **The student's fees page:** the statement (lines, total, discounts, net, paid, balance). The Accountant sees Record a
  payment, and Refund when there is a credit. The Principal sees Give a discount, and Edit or Remove on a discount
  within its 15 days, with its history. The student sees their own statement and any extra amount to pay.
- **Principal:** the approvals inbox shows structure and edit requests; a Discounts report.

## 12. Migration and release

The migration rebuilds `fee_structures` and `fee_items` and is **not backward compatible**, like `0032`. Each existing
structure becomes a named structure with one live period (its term's dates) with its items as lines, and its level
linked; items keep their amounts. Existing charges, payments and the ledger chain are untouched. Open discount
requests are declined with a note. It is applied with the new Worker, after noting the D1 Time Travel bookmark, on
staging first. Royal's staging fee data is UAT data. Lahan has fees off.

## 13. Tests (before code)

- **Ledger and money:** property tests that corrections never change a balance except by the stated difference; the
  chain stays whole; whole paisa; net fees never below zero.
- **Structure:** lines add up to the total; only a draft version changes; one live version; linking needs a live period
  and no approval and is audited; two levels share one; overlapping dates refused; unlink and re-link refused after a
  payment, including a payment racing the unlink.
- **New period:** a new period copies the lines as a draft with new dates; it needs approval before linking.
- **Automatic charging:** linking charges every student once; a repeat makes nothing; a student who joins later is
  charged; a retry and the sweep catch a miss; a Left student is not charged; fees off charges nothing.
- **Edit flow:** the live version stays in force; the request needs approval; the draft is a copy; stale and
  self-approval refused; a decline changes nothing.
- **Corrections:** a price drop gives a credit equal to the difference; a rise adds the difference on every charge; a
  repeat approval changes nothing.
- **Discounts:** only the Principal (the Accountant, Co-ordinator, Teacher and Student refused); over the fees refused,
  including two at once; edit and remove within 15 days and refused on day 16, with the day boundary in Nepal time;
  the statement shows the discount as it stands; every change audited.
- **Refund:** only up to the credit; two at once cannot exceed it; none when there is no credit; reversals still need
  approval.
- **Leaving:** the Co-ordinator's request leaves the student active and the account open; the Principal sees the
  statement; a decline changes nothing; self-approval and a stale request (class changed) are refused; an approval
  marks the student Left and closes the account in the same batch; after it, a payment, discount (new, edit, removal),
  refund, reversal and charge are each refused for every role, including a request that was already in flight; the
  owed amount and any credit are kept; approving twice changes nothing; the Co-ordinator sees no amount; the dues list
  shows the closed owed amount; the mid-year flow reaches zero before the approval.
- **Permissions:** every role tries every action; Student A never sees Student B's fees; a section-scoped Accountant
  gets nothing from the other section; the second-school test.
- **Failure paths:** a duplicate submit; a repeated approval; the response lost after the batch.

## 14. Slices

| # | Slice | Delivers |
|---|---|---|
| 1 | Structures, periods, versions, linking | Migration, triggers, create and start-next-period, send, approval, link and unlink (tests first) |
| 2 | Automatic charging | `chargeEnrollment`, the enrollment hooks and outbox event, the sweep, the counts |
| 3 | Edit flow and corrections | The edit request, the new draft version, the corrections in the approval's batch |
| 4 | Discounts and refunds | The Principal's discount with its window and cap, the credit refund, the retired approval kinds, the rule changes in `DECISIONS.md` and `CLAUDE.md` |
| 5 | Leaving | The `student_leave` approval kind; approval marks Left and closes and freezes the fee account in the same batch; the closed state in the statement and the dues list |
| 6 | Screens | Structures, link, price change, the statement, the discount controls, the report |
| 7 | Exit | The end-to-end test for both schools, the staging migration, a UAT script |

## 15. Not in this design

Per-class fee overrides; late fees (out of scope, `CLAUDE.md` section 10); a real payment gateway (Phase 9);
instalment plans (the whole total is due on the start date); partial reversal of a payment; reopening a closed account (never, section 8).
