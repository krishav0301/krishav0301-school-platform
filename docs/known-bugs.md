# Known bugs

Open bugs found in testing, not yet fixed. Move an entry to `DECISIONS.md` (with its fix) when it is closed.

| # | Found | Where | Bug | Status |
|---|---|---|---|---|
| B-001 | 2026-10-09 | Setup, Wings | An empty wing (no programmes or subjects) cannot be deleted. | Fixed 2026-10-09. Cause: a wing's subjects were not counted by the "can delete" check, so the Delete button showed but the database refused. Now a wing with only unused subjects deletes together with them; one with a taught subject stays blocked. Not yet committed. |
| B-002 | 2026-10-09 | Sections | There is no option to edit a section once it is created; it cannot be re-edited. | Fixed 2026-10-09 for class sections (Morning, Evening): a section with no name had no Rename option in the Classes screen; it now does. Not yet committed. If you meant another screen, tell me. |
| B-003 | 2026-10-09 | Setup, Subjects (Wing and Level pickers) | When a wing has only one Department, it is shown as plain text ("Department: English Boarding School") instead of a dropdown. It should stay a dropdown even with one choice. | Fixed 2026-10-09 in `StructurePicker.tsx` (Wing, Department and Level are all dropdowns now; the admissions form is unchanged). Not yet committed. |

## Requests

| # | Asked | Where | Request | Status |
|---|---|---|---|---|
| R-001 | 2026-10-09 | Setup, Subjects / Curriculum | Let a class copy its subjects from another class under the same Department (not programme), instead of adding them one by one. | Built 2026-10-10 (D-134): a Copy subjects button on the Curriculum screen. Not yet committed. |
| R-002 | 2026-10-09 | Setup, Subjects | Let a subject be deleted when no student is linked to it (no enrolment, marks or timetable use it). | Not started. Needs a design: what counts as "linked", and whether it is a real delete or an archive (no hard deletes is a standing rule). |
| R-003 | 2026-10-10 | Sign-in | The one-time (temporary) password should be 4 digits, not long. | Built 2026-10-10 (D-134): 4 digits, valid 24 hours and 3 wrong tries. Not yet committed. |
| R-004 | 2026-10-10 | Teaching | Assigning a teacher to a subject should offer only the teachers linked to that wing. | Built 2026-10-10 (D-134). Not yet committed. |
| R-005 | 2026-10-10 | New page for Admin and Co-ordinator | A flow-chart page that shows the whole setup: how wings, departments, levels, sections, classes, teachers and subjects link to students. | Built 2026-10-10 (D-134): Setup > Setup map, by term, with the exam. Not yet looked at in a browser. Not yet committed. |
