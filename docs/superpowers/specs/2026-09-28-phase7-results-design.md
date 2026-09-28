# Phase 7: results (draft design)

Status: **draft**, written 2026-09-28 after Phase 5 closed. The PM approved Phase 7 with stated defaults (D-069). One
point blocks the grading slice: `CLAUDE.md` section 6 requires the NEB scale to be verified against NEB's own
sources before it is coded, and this environment cannot reach `www.neb.gov.np` (blocked by the network policy). The
widely republished scale is recorded below as **unverified**.

Rules it rests on: `CLAUDE.md` section 6 "Marks and results" (component entry in a bulk grid, edit until verified,
Draft / Under review / Verified / Published, publish a whole class per terminal only when every subject is verified,
a per-programme grading policy, a class with no policy cannot be published, a policy change affects only
unpublished results, published marks cards are snapshots, Top 20 per section, name and rank only, after publish);
source 6.2 (the teacher's grid, draft-save, missing marks flagged), 6.3 (results inbox, verify, send back with a
note, bulk approve, publish gating, whole-class sheet, Top 20), 6.9 (recheck); section 9 defaults (ties share a
rank; notify the Admin on every post-publish change, with a required reason; Top 20 shown to students, name and rank
only); D-056 (elective groups; a student's pick is saved once students exist).

## Slices

| # | Slice | Delivers |
|---|---|---|
| 1 | Grading policies (tests first) | The policy seam and two policies: NEB letter grades with a credit-weighted GPA (+2), and percentage with division (Bachelor's placeholder and the sample school). Attached to a programme; a change affects only unpublished results |
| 2 | Elective picks and the marks grid | Each student's elective pick (D-056), so a grid lists only the students taking that subject; the teacher's component-wise grid per class, subject and terminal, draft-save, missing marks flagged, submit for review |
| 3 | Verify and publish | The Co-ordinator's inbox (one card per class, subject and terminal), verify or send back with a note, bulk approve; publish a whole class per terminal, gated; published marks cards stored as snapshots in the publish batch |
| 4 | Results for students and staff | The student's results by terminal and year and their marks card (printable HTML); Top 20 per section; the whole-class sheet |
| 5 | Recheck and exit | A student's recheck request; the Co-ordinator edits and republishes with a required reason; the Admin and the student notified in-app; the exit test for both schools |

## Grading, stated defaults (all `OPEN:` until the client confirms)

- **+2 (NEB), UNVERIFIED:** per component percentage to a letter grade and grade point: 90 and above A+ 4.0;
  80 A 3.6; 70 B+ 3.2; 60 B 2.8; 50 C+ 2.4; 40 C 2.0; 35 D 1.6; below 35 NG 0. NG in a subject when theory is below 35%
  or practical / internal below 40%. Subject grade point = the credit-weighted grade points of its components; GPA =
  credit-hour-weighted mean of subject grade points, two decimals; no total. Source for now: secondary sites only.
- **Percentage and division (placeholder):** total percentage; Distinction 80+, First 60+, Second 45+, Third 32+ (Bachelor's
  and the sample school's pass mark placeholders, to be replaced by each programme's real rule).
- **Ties share a rank** (section 9). Top 20 ranks within a section (per section, CLAUDE.md), by GPA or percentage.
- **Marks** are whole hundredths, as mark components already are (`max_hundredths`).
