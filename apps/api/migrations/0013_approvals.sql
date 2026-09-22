-- Approvals (Phase 3, slice 4, D-061): a generic table, five fixed kinds, only website_content wired.
-- Nothing here is deleted. `subject_id` is the subject's own internal id; it is not a real foreign key
-- because it is polymorphic across kinds (a plain integer, checked only by the handler that owns it).

CREATE TABLE approval_requests (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('website_content', 'fee_structure', 'discount', 'reversal', 'refund')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'stale', 'withdrawn')),
  requested_by INTEGER NOT NULL REFERENCES users (id),
  subject_type TEXT NOT NULL,
  subject_id INTEGER NOT NULL,
  subject_version INTEGER NOT NULL,
  snapshot TEXT NOT NULL CHECK (json_valid(snapshot)),
  decided_by INTEGER REFERENCES users (id),
  decided_at TEXT,
  decision_reason TEXT,
  created_at TEXT NOT NULL,
  CHECK ((status IN ('approved', 'declined')) = (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CHECK (status <> 'declined' OR decision_reason IS NOT NULL)
);

-- One pending request per subject.
CREATE UNIQUE INDEX approval_requests_one_pending ON approval_requests (subject_type, subject_id) WHERE status = 'pending';
CREATE INDEX approval_requests_requester ON approval_requests (requested_by, status);

-- The fingerprint an approval is checked against at decision time (D-061). Every content write bumps it.
ALTER TABLE content_items ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
