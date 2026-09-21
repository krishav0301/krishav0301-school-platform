# Data model

Status: draft for PM review, 2026-09-20. Independent of the hosting choice (D-018). Phases 1 to 5 are specified. Phases 6 to 8 are outlined only.

## Conventions

- **Two ids.** An internal `id` for joins, and a `public_id` (random, unguessable) in every URL and API response. Sequential ids are never exposed, so one student cannot guess another's record.
- **Money** is a whole-number `amount_paisa`. Never a float or decimal.
- **Dates** are stored as AD dates. Timestamps are UTC, shown in Nepal time. BS is derived for display (D-014). A date of birth also stores the BS text exactly as entered.
- **No hard deletes.** Rows are deactivated or archived (`is_active`, `archived_at`).
- **Every write goes through a service** and writes an `AuditEvent` in the same transaction.
- **Nothing school-specific** in table or column names. Names such as "+2" or "BBS" are data.

## Structure of the institution

```
School (one row)
 └─ Section            "+2", "Bachelor's"        (configurable names)
     └─ Programme      "BBS", "+2 Science"        (affiliation: NEB / PU / TU)
         └─ Level      Grade 11, Grade 12 / Year 1..4
             └─ Class  = academic year + programme + level (+ optional label, e.g. "Morning")
                 └─ SubjectOffering → MarkComponent
Student (permanent) ── Enrollment (student + academic year + class) ── year data hangs off Enrollment
```

## Phase 1: configuration, accounts, audit

| Table | Key columns | Rules |
|---|---|---|
| `School` | name, short_name, currency, timezone, template_key, region_pack | One row per deployment |
| `Section` | key, name, ordering | Names are data |
| `ModuleSwitch` | key, enabled | Optional modules on or off |
| `Theme` | tokens (JSON), logo_file, is_active | Contrast checked before save |
| `TerminologyOverride` | key, text | For example "Co-ordinator" to another title |
| `VerifiedBSYear` | bs_year, verified_at, source_note | Dates in other years are refused (D-014) |
| `User` | email (unique, lowercase), password_hash, full_name, phone, is_active, must_change_password, failed_login_count, locked_until, last_login_at | Argon2 or the strongest hash the platform allows |
| `RoleAssignment` | user, role, scope_type, section (nullable), is_active | `scope_type` is `own`, `assigned`, `section` or `institution`. Section scope requires a section. Unique per user, role, scope, section |
| `TwoFactorDevice` | user, secret (encrypted), confirmed_at | Authenticator app (Super Admin, and staff) |
| `TrustedDevice` | user, token_hash, expires_at | "Remember this device" 30 days |
| `SignInEvent` | user (nullable), email_tried, success, reason, ip, user_agent, at | Insert-only. Feeds the Sign-ins view |
| `AuditEvent` | at, actor, action, entity_type, entity_public_id, summary, before (JSON), after (JSON), reason, request_id | **Insert-only.** Super Admin actions display as "Support" |
| `OutboxEvent` | type, payload, processed_at, attempts | Written in the same transaction as the change; a job drains it |

Roles: `student`, `teacher`, `coordinator`, `accountant`, `admin`, `super_admin`. Today every Co-ordinator and Accountant has `institution` scope (D-004).

## Phase 2: content and files

| Table | Key columns | Rules |
|---|---|---|
| `ContentItem` (`content_items`, D-039) | kind (notice, holiday, routine, vacancy, post), title, body, contact (vacancy only), publish_on, hide_after (AD days by Nepal's clock), status (draft, waiting, live), is_urgent, created_by, published_by, published_at | Expired is derived from hide_after, never stored. Image and file columns come with R2 (D-020) |
| `FileObject` | storage_key, content_type (from content, not extension), size, sha256, original_name, uploaded_by, status (temp, attached, deleted), expires_at | Private. Served only through a permission check and a short-lived link. Temp uploads expire and are cleaned up |

## Phase 3: academic setup and approvals

| Table | Key columns | Rules |
|---|---|---|
| `AcademicYear` (`academic_years`, built in slice 1, D-057) | public_id, bs_year (unique), label (unique), start_date, end_date (AD), status (draft, active, closed), created_at, closed_at | Year must be verified. **At most one active year** (a partial unique index). **A closed year rejects all writes**: the service refuses, and database triggers on the year and on its classes and terminals refuse again. Closing a year is Phase 8. Managed by a whole-school Co-ordinator or the Super Admin |
| `Programme` (`programmes`) | public_id, key (unique), name, section, affiliation, ordering, is_active | Made by the Co-ordinator (key generated) or seeded from the pack's `academics` block **only where missing**, never overwritten. Switched off, never deleted. A section-scoped Co-ordinator manages only their own section's |
| `Level` (`levels`) | public_id, programme, ordinal (1 to 20, next free), name, is_active | Grade 11 and 12 for +2. Year 1 to 4 for bachelor's. Unique per programme and ordinal |
| `Class` (`classes`) | public_id, academic_year, programme, level, label (`''` when none, so "unique" works), is_active; `class_teacher` arrives in slice 3 | A composite foreign key ties the level to its own programme. Unique per year, level, label. Switched off, never deleted |
| `Terminal` (`terminals`) | public_id, academic_year, name, ordinal (1 to 12, next free) | Yearly with terminals (D-006). Belongs to the whole school, so managed like a year. Shown with the school's own word for it |
| `Subject` (`subjects`, slice 2, D-058) | public_id, name (unique, letter case ignored), code (optional, unique), is_archived | The school's catalogue. Archived, never deleted; an archived subject cannot be added to a level. Any Co-ordinator may add one (it is only a name); renaming, recoding and archiving need a whole-school Co-ordinator or the Super Admin |
| `SubjectOffering` (`subject_offerings`) | public_id, **programme level** (not class, D-056), subject, credit_hundredths (optional, 1 to 10000), elective_group (optional), is_active | A class inherits its level's subjects, so a new year does not re-enter them. Unique per level and subject. A composite foreign key ties the group to the offering's own level. Credit hours are whole hundredths (375 = 3.75). A section-scoped Co-ordinator manages only their own section's |
| `ElectiveGroup` (`elective_groups`, D-056, D-058) | public_id, level, name, pick_count (1 to 10, default 1), is_active | "Pick one of Biology, Mathematics, Computer Science", approved by the PM 2026-09-21. Unique per level and name. Only the groups are stored in Phase 3; a student's pick is saved when students exist (Phase 4) |
| `MarkComponent` (`mark_components`) | public_id, subject_offering, name, max_hundredths (1 to 100000), ordinal (1 to 10, next free), is_active | Theory, practical, internal. Marks stored as whole hundredths (7500 = 75). Unique per offering by name and by ordinal. Switched off, never deleted |
| `TeacherAssignment` | teacher, subject_offering | A teacher may hold many |
| `StaffProfile` (`staff_profiles`, slice 3a, D-059) | user, home_section (nullable) | One row per **teacher**, holding their home section. A Co-ordinator's or Accountant's section is in their role assignment. A staff job title (designation) is not built. |
| `ApprovalRequest` | kind (website_content, fee_structure, discount, reversal, refund), status (pending, approved, declined, stale), requested_by, subject_type, subject_id, subject_version, snapshot (JSON), decided_by, decided_at, decision_reason | Requester and decider must differ. **One pending request per subject.** Approve-and-apply runs in one locked transaction. A changed subject makes it stale |

## Phase 4: admissions and the student record

| Table | Key columns | Rules |
|---|---|---|
| `Application` | submission_token (unique), status (email_unverified, pending_review, needs_changes, approved, rejected), applicant details, programme, level, academic_year, referred_by, email_verified_at, reviewed_by, decision_reason, changes_requested (JSON), duplicate_flags (JSON), walk_in, student (set on approval) | Rate limited. Enters the queue only after email verification. Rejection is final |
| `ApplicationDocument` | application, kind (transcript, character_certificate, citizenship, photo, other), file | Multiple typed documents (`OPEN:` until PM approves) |
| `Student` | sid (unique, immutable), user, first_name, middle_name, last_name, dob_ad, dob_bs, phone, email, address, previous_school, guardian_name, guardian_phone, status (active, left, graduated) | **Permanent.** No year data lives here. Duplicate check on phone, or name plus date of birth |
| `Enrollment` | student, academic_year, class, roll_no, status (active, promoted, repeated, left, graduated) | Unique per student and year. Attendance, marks, fees and receipts hang off this |
| `SIDCounter` | next_sequence | One row, locked while assigning. SID = admission BS year + sequence, for example `2083-00123`, assigned at approval |
| `Notification` | recipient, event_key, channel (in_app, email, sms), payload, status, attempts, sent_at, read_at | **Unique on event, recipient and channel**, so a retry never sends twice |

Approval creates the `Student`, the `User`, the `Enrollment` and the SID in one transaction.

## Phase 5: daily school life

`StudentAttendance` (enrollment, date, present or absent, marked_by; unique per enrollment and date), `TeacherAttendance` (teacher, date, present, absent or leave, marked_by, reason for past edits), `ActivityLog` (subject_offering, teacher, date, text), `Note` (subject_offering, file, uploaded_by), `Assignment` (subject_offering, title, instructions, deadline, file), `Submission` (assignment, enrollment, file, status, marks, feedback, resubmission_requested).

## Phases 6 to 8: outline only

- **Fees:** `FeeStructure`, `FeeItem`, `DiscountRequest`, `LedgerEntry` (append-only; charge, discount, payment, reversal, refund, carried dues; each reversal or refund points to the original), `Receipt` (gapless per section and year, from a locked counter), `VoucherSubmission`, `PaymentAttempt` (unique gateway reference).
- **Results:** `GradingPolicy` (per programme), `MarkEntry`, `ResultStatus` (per class, subject, terminal: draft, under review, verified, published), `MarksCardSnapshot`, `RecheckRequest`.
- **Year lifecycle:** rollover decisions, previous dues, Left and Graduated with zero dues.

## Rules the database itself must enforce

1. One enrollment per student per year.
2. A closed year rejects writes.
3. The ledger cannot be updated or deleted.
4. The audit log cannot be updated or deleted.
5. A SID is unique and cannot be changed.
6. An approval cannot be decided by its requester, and only one can be pending per subject.
7. A notification is unique per event, recipient and channel.
8. An application's submission token is unique.
9. Attendance is unique per enrollment per day.

**If the database is PostgreSQL,** rules 3 to 5 use triggers, and rule 4 also uses privileges so the application account can only insert. **If it is Cloudflare D1 (SQLite),** there are no database accounts, so rules 3 to 5 rely on triggers alone and on the application never running schema changes. That is a weaker guarantee, and it is one of the things the hosting test must weigh.
