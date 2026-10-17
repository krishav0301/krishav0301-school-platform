-- Editing an approved fee structure, and the approval kinds the fees redesign needs (D-172, slices 3 and 5).
--
-- 1. The approvals engine's `kind` is a CHECK list, so adding kinds means rebuilding `approval_requests` the way 0030 and
--    0031 rebuilt theirs on D1: copy the rows aside, drop it, create it again under the same name with the same ids, put
--    the rows back, with foreign keys deferred until the commit. Nothing references it. `fee_structure_edit` is the
--    Accountant's request to edit an approved structure; `student_leave` is the Co-ordinator's request to mark a student
--    Left (slice 5). The `discount` and `refund` kinds are kept so the rows already written stay readable; no new one is made.
-- 2. `fee_edit_requests`: one row for each request to edit, kept until it is decided, so the Principal sees why and the
--    request can go stale. At most one is open for a structure.

PRAGMA defer_foreign_keys = true;

CREATE TABLE approval_requests_copy AS SELECT * FROM approval_requests;
DROP TABLE approval_requests;

CREATE TABLE approval_requests (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('website_content', 'fee_structure', 'discount', 'reversal', 'refund', 'fee_structure_edit', 'student_leave')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'stale', 'withdrawn')),
  requested_by INTEGER NOT NULL REFERENCES users (id),
  subject_type TEXT NOT NULL,
  subject_id INTEGER NOT NULL,
  subject_public_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  subject_version INTEGER NOT NULL,
  snapshot TEXT NOT NULL CHECK (json_valid(snapshot)),
  decided_by INTEGER REFERENCES users (id),
  decided_at TEXT,
  decision_reason TEXT,
  created_at TEXT NOT NULL,
  CHECK ((status IN ('approved', 'declined')) = (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CHECK (status <> 'declined' OR decision_reason IS NOT NULL)
);

INSERT INTO approval_requests (id, public_id, kind, status, requested_by, subject_type, subject_id, subject_public_id, summary, subject_version, snapshot, decided_by, decided_at, decision_reason, created_at)
SELECT id, public_id, kind, status, requested_by, subject_type, subject_id, subject_public_id, summary, subject_version, snapshot, decided_by, decided_at, decision_reason, created_at FROM approval_requests_copy;
DROP TABLE approval_requests_copy;

CREATE UNIQUE INDEX approval_requests_one_pending ON approval_requests (subject_type, subject_id) WHERE status = 'pending';
CREATE INDEX approval_requests_requester ON approval_requests (requested_by, status);
CREATE INDEX approval_requests_status ON approval_requests (status, kind);

CREATE TABLE fee_edit_requests (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  -- The live version it asks to edit.
  structure_id INTEGER NOT NULL REFERENCES fee_structures (id),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'approved', 'closed')),
  -- The draft version made when it was approved.
  new_version_id INTEGER REFERENCES fee_structures (id),
  requested_by_user_id INTEGER NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL,
  CHECK ((status = 'approved') = (new_version_id IS NOT NULL))
);
CREATE UNIQUE INDEX fee_edit_requests_open ON fee_edit_requests (structure_id) WHERE status IN ('draft', 'pending');

CREATE TRIGGER fee_edit_requests_no_delete BEFORE DELETE ON fee_edit_requests
BEGIN SELECT RAISE(ABORT, 'fee edit requests are kept'); END;
