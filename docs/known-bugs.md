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
| R-001 | 2026-10-09 | Setup, Subjects / Curriculum | Let a class copy its subjects from another class under the same Department (not programme), instead of adding them one by one. | Not started. Needs a short design first (what is copied: subjects, credits, groups, full marks and practical; what happens to ones already there). |
| R-002 | 2026-10-09 | Setup, Subjects | Let a subject be deleted when no student is linked to it (no enrolment, marks or timetable use it). | Not started. Needs a design: what counts as "linked", and whether it is a real delete or an archive (no hard deletes is a standing rule). |
