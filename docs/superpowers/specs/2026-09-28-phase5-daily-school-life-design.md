# Phase 5: daily school life

Status: the PM approved Phase 5 (and Phase 7) on 2026-09-28 ("Let's complete phase 5, and 7") after two answers:
**no file uploads yet** (R2 stays off, D-020: notes, question papers and homework are text and links only),
and Phase 7 is built with stated defaults. As with Phase 4 (D-063), this is a standing authorisation to build
the phase through; each slice still ends with tests, a pull request and a report.
Rules it rests on: `CLAUDE.md` sections 5 to 7 (attendance, audit, dates, permissions), the source document
sections 6.1 to 6.3 (student dashboard, teacher attendance view, Class Teacher attendance, content,
assignments, activity log, Co-ordinator's teacher attendance), `docs/data-model.md` (Phase 5), the permission
matrix rows already carried for phase 5, and the optional module switches (`attendance`,
`teacher_attendance`, `homework`, `notes`). Logged as D-069 onwards.

## 1. Goal

A school day runs in the portal: the Class Teacher marks the class once a day, the Co-ordinator marks the
teachers, every teacher writes the day's activity log per subject, shares notes and question papers, and sets
and reviews homework. A student (and the parent, who shares the login) sees attendance with its percentage,
the activity log, notes and homework. Each role's dashboard shows what matters today.

Not in Phase 5: file uploads (R2, D-020), SMS (Phase 9), absence alerts by SMS (in-app only anyway), Excel
export (a dependency, asked for separately), fees (Phase 6), marks (Phase 7), closing a year (Phase 8).

## 2. Slices

| # | Slice | Delivers |
|---|---|---|
| 1 | Student attendance | Class Teacher marks today (pre-filled Present, same-day edits only), class and student views with percentage and the 75% flag, the student's own attendance card, the "More" menu overflow |
| 2 | Teacher attendance | The Co-ordinator's daily list pre-filled Present (Absent, On leave), past days editable with a reason; a teacher's own monthly view |
| 3 | Activity log | One entry per class, subject and day by the subject's teacher; the missing-today reminder list; the student's and the Co-ordinator's read views |
| 4 | Notes and homework | Notes and question papers (text and links); assignments (deadline, instructions, late flag, text submission, marks and feedback, resubmission request then approve) |
| 5 | Dashboards and exit | Role dashboards (teacher: today; student: attendance, homework, activity, notes), the Phase 5 exit test for both schools |

## 3. Decisions that shape every slice

1. **Two modules.** `attendance` (`CLAUDE.md` section 4 already names it: student and teacher attendance) and a new
   `classwork` (the activity log, notes and question papers, assignments and submissions), each with the usual
   `routes`, `queries`, `schema`, `guard`. They read classes, enrollments and assignments in their own SQL
   statements, as `admissions` does, and write only their own tables.
2. **Year data hangs off the enrollment** (student attendance, submissions) or off the class and offering
   (activity log, notes, assignments), never off the student.
3. **A closed year rejects every write**, twice: the service's conditional SQL, and `BEFORE INSERT/UPDATE`
   triggers joining to `academic_years`. No hard deletes: a note or assignment is withdrawn (`withdrawn_at`),
   which also serves "delete and re-upload".
4. **"Today" is the Nepal date** (`nepalDate`, UTC+5:45). Same-day rules are enforced in the service **and** by a
   trigger comparing against `date('now', '+345 minutes')`, so a guard removed from code still holds.
5. **Saturday is the weekly holiday** (`CLAUDE.md` section 6, "Dates"). Attendance is not taken on a Saturday.
   Other holidays are a config placeholder (section 9), so no holiday calendar blocks marking yet (`OPEN:`).
6. **Every write is one `batch()`** that re-checks the actor inside it (the Class Teacher is still this class's
   Class Teacher; the teacher still holds the assignment) and carries its audit entry, written only if the change
   happened. One audit entry per class-day submission, not per student, to stay inside the free write budget.
7. **Module switches are enforced by the API**, not only the menu: the guard SQL includes the module's switch,
   so a school that turned `attendance` off gets 404 from the attendance routes (same round trip).
8. **Grants build the queries** (`c.get("grant")`): `classOnly` means "the class whose Class Teacher I am",
   `assigned` means "my active teacher assignments", `own` means "my own enrollment", section-scoped staff see
   their section only. Ids from the URL are never trusted alone.
9. **Attendance percentage** = present days / marked days in the year, rounded down to a whole percent. The alert
   threshold is **75%, a placeholder** (section 9) in the attendance policy seam (`attendancePolicy()`),
   `OPEN:` until the client confirms. Below it, the student's card and the Co-ordinator's class view flag it
   (in-app only, per section 7).
10. **Words** in `messages.ts`, theme tokens only, a markup test per new component, `apple-design` review.

## 4. Slice 1: student attendance

### Table (`0015_student_attendance.sql`)

`student_attendance`: `id`, `enrollment_id` -> `enrollments`, `on_date` (AD `YYYY-MM-DD`, the Nepal date),
`status` (`present`, `absent`), `marked_by_user_id`, `marked_at`, `updated_at`. Unique (`enrollment_id`,
`on_date`). Triggers: insert or update only when `on_date` is today in Nepal; never when the enrollment's year is
closed; never delete.

### API

| Route | Action | Who |
|---|---|---|
| `GET /api/attendance/classes` | `attendance.student.view` | Class Teacher: their class; Co-ordinator: their sections; Admin: read. Classes of the active year, each with whether today is marked |
| `GET /api/attendance/classes/{id}/day?date=` | `attendance.student.view` | The roster for a day (default today), each student's status or not marked |
| `PUT /api/attendance/classes/{id}/today` | `attendance.student.mark` | Class Teacher only. Body: the absent enrollments; everyone else is Present. Repeating it the same day replaces the day (idempotent) |
| `GET /api/attendance/classes/{id}/summary` | `attendance.student.view` | Each student's present, absent, marked days, percentage, below-threshold flag |
| `GET /api/attendance/me` | `attendance.student.view` (own) | The student's own year: totals, percentage, flag, and the days marked absent |

### Screens

- **Teacher, "Attendance" tab**: today's roster for their class, everyone Present; tap a name to mark Absent;
  one Save. Shows "Saved at 10:42" after, and on a Saturday says the school is closed.
- **Co-ordinator and Admin, "School day" tab**: a class picker, today's state per class, a day's roster, and the
  class summary with the flagged students.
- **Student dashboard**: an attendance card with the percentage, days present and absent, and the flag.
- **Menu overflow**: the Co-ordinator and the Admin now have six places. On a phone the tab bar shows four
  and a fifth "More" tab that lists the rest (Apple, `tab-bars.md`); the sidebar on a wide screen shows all.

## 5. Slice 2: teacher attendance

`teacher_attendance`: `user_id`, `on_date`, `status` (`present`, `absent`, `leave`), `reason` (required when
the day is not today), `marked_by_user_id`, timestamps. Unique (`user_id`, `on_date`). The Co-ordinator sees every
active teacher of their sections pre-filled Present (a row is written only on save), saves the day, and may edit a
past day with a reason (audit carries the before and after). The teacher sees their own month, read-only.
No future dates, no Saturdays.

## 6. Slice 3: activity log

`activity_log`: `class_id`, `offering_id`, `on_date`, `teacher_user_id`, `body` (1 to 2,000 characters),
timestamps. Unique (`class_id`, `offering_id`, `on_date`). Written by the teacher holding the active assignment,
editable the same day only. "Mandatory, with a reminder if skipped": the teacher's dashboard lists today's
subjects without an entry, and the Co-ordinator's school-day view shows today's missing entries per class (in-app,
no SMS). Students read their own class's entries; the Co-ordinator reads their sections; the Admin reads.

## 7. Slice 4: notes and homework

- `class_notes`: `class_id`, `offering_id`, `kind` (`note`, `question_paper`), `title`, `body`, `link` (an
  `https://` address, optional), `teacher_user_id`, `created_at`, `withdrawn_at`. Live on creation; withdraw to
  replace. Students of the class see them with a watermark line (their name and SID) and copy and print
  discouraged; stated as a deterrent only. `OPEN:` files wait for R2.
- `assignments`: `class_id`, `offering_id`, `title`, `instructions`, `due_at` (UTC instant, entered as a BS date
  and a Nepal time), `max_marks` (optional), `teacher_user_id`, `withdrawn_at`.
- `submissions`: `assignment_id`, `enrollment_id`, `body` (text), `submitted_at`, `is_late` (computed on
  submit against `due_at`), `status` (`submitted`, `reviewed`, `resubmit_requested`, `resubmit_allowed`),
  `marks`, `feedback`, `reviewed_at`. Unique per assignment and enrollment. The student submits once; the
  student asks to resubmit, the teacher allows it, and the next submission replaces the body (the old one is kept
  in the audit entry).

## 8. Slice 5: dashboards and exit

The teacher's dashboard: today's class attendance (if Class Teacher), today's missing activity entries,
submissions waiting for review. The student's: attendance, the latest activity entries, open homework, recent
notes. The exit test runs the whole phase through the real API for both packs, including the switched-off
`notes` module on the sample school.
