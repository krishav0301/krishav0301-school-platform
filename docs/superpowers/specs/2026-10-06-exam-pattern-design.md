# Exam pattern: one exam per term (design)

Status: **draft, waiting for the PM's approval** (2026-10-06). Decided with the PM in conversation, recorded as D-114.
It replaces how Phase 7 sets up exams and calculates results (D-079: the per-programme grading policy, NEB credit
GPA, percentage with division). What Phase 7 built around that stays: the marks grid, Draft / Under review /
Verified / Published, publish a whole class per terminal, snapshot marks cards, rechecks, the class sheet, the
closed-term lock.

## The model

**Exam pattern.** Each academic term has exactly one, and it is always out of 100. Every class and subject in the
term follows it. A class that needs a different exam goes in a different term. The term page says so:
*"Every class in this term follows the same exam pattern. If some classes need a different exam, create a
separate term for them."*

The **Co-ordinator** creates it, for a term the Principal has already created. It asks:

| Question | Answer |
|---|---|
| Grade system? | Yes / No |
| Terminals | Name and weight for each. The weights must add up to 100 (for example 30 + 30 + 40) |
| Minimum % to pass, theory | For example 35 |
| Minimum % to pass, practical | For example 40. Used only by subjects with a practical |
| Grade ranges (Grade = Yes only) | Letter and the minimum % for each row, for example A+ 90, A 80, … NG below the pass rule |

There is no credit system and no grade point or GPA for now (`OPEN:` both can be added later).

**Subject** (set up once, on the Setup screen):
- Full marks of the paper (default 100).
- ☐ Has practical. When ticked, its split: theory and practical out of the full marks (75/25, 70/30, 50/50).

**Terminal** (part of the pattern): Practical in this terminal? Yes / No.
- **No:** every subject's paper is theory only, out of the subject's full marks.
- **Yes:** subjects with a practical get a theory column and a practical column, with their own split. The rest
  stay theory only.

## Marks and scaling

- The teacher enters marks out of the paper's full marks. The system scales them to the terminal's weight:
  `scaled = (theory + practical) × weight ÷ full marks`. Example: 67/100 in a 30-weight terminal = 20.10.
- Marks are whole hundredths, never floats, as today. Nothing is rounded until the final figures (two decimals,
  half up).
- Theory and practical are kept apart behind the scaled figure, for the pass check.

## Final result and pass or fail

- **Subject final** = the sum of the subject's scaled marks over all terminals, out of 100.
- **Pass check, on the final result only** (a weak terminal never fails anyone on its own):
  - theory % = scaled theory earned ÷ scaled theory possible, over all terminals;
  - practical % = the same, counting **only the terminals where the practical was held**;
  - the subject is passed when theory % and practical % (where there is one) reach their minimums.
- **The student passes only by passing every subject.**
- **Overall percentage** = the average of the subject finals.
- **Grade = No:** the result is the overall percentage and Pass or Fail. No division.
- **Grade = Yes:** each subject shows the letter for its final %, and the overall shows the letter for the overall %.
  A failed subject shows **NG**, and then the overall shows **NG** too.
- Each terminal's own card shows its marks, and its percentage or grade, **for information only**: no pass or fail.

## Publishing

- Each terminal is published per class, as today (every subject verified first).
- When a class's **last terminal** is published, its **final result is published automatically** in the same batch,
  as a snapshot.
- A recheck that corrects a terminal mark after the final is published also adds the next version of the final card.
- **Top 20:** final result only, by overall percentage, among students who passed. Ties share a rank. Per section and
  level, as today.
- Closing a term still needs every class's results published for every terminal (so the final exists).

## Rules that keep it safe

- The pattern can be edited until the first mark is entered in the term. After that it is locked.
- A terminal's setup (practical Yes / No) is locked once any mark is entered for it.
- A subject's full marks and split are locked for a term once any mark is entered for it in that term.
- A class cannot be published without a pattern.
- Every change is audited, in the same batch.

## Stated defaults (`OPEN:`, not asked)

- **Absent** in a terminal paper counts as 0 in the sum and is shown as AB.
- The pattern is entered fresh for each term; "copy from the previous term" is a later convenience.
- Packs seed a demo pattern for each school through the same service the screen uses (Royal Softech: Grade = Yes;
  the sample school: Grade = No).

## What goes away

- The per-programme grading policy (`programmes.grading_policy`), the built-in NEB scale and GPA, the division, and
  the per-subject list of free components (`mark_components` with names and kinds) are replaced by the pattern and
  the subject's split.
- Credit hours stay stored on subjects but are not used.
- Results data entered under the old design on staging is cleared (UAT test data only; the PM agreed).

## Slices

| # | Slice | Delivers |
|---|---|---|
| 1 | The calculation (tests first) | Pure functions: scaling, the pass check with practical only where held, every subject passed, percentage, grade letters, NG. Property tests that the finals never exceed 100 and that weights add up |
| 2 | Pattern and subject setup | Migration; the Co-ordinator creates and edits the pattern (locks); the subject's full marks and practical split; the term page notice; permissions and audit |
| 3 | Marks grid on the pattern | The teacher's grid per terminal with the right columns; draft, submit, verify, send back as today |
| 4 | Publish and the final result | Terminal publish; the automatic final in the same batch; snapshots; rechecks feeding the final |
| 5 | What people read, and the exit test | The student's terminals and final card, the class sheet with finals, the Top 20 on finals; both schools end to end (a graded and a percentage pattern, a terminal without practical); browser check and design review |
