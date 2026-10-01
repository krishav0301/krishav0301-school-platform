-- Indexes for the Admin's dashboard (D-088). Indexes only: no table or row changes, so this is backward compatible.

-- Recent activity reads the newest audit events of a few kinds.
CREATE INDEX audit_events_action ON audit_events (action, id);

-- Fees collected in the last 30 days and the 30 before reads money entries by kind and time.
CREATE INDEX ledger_entries_kind_time ON ledger_entries (kind, created_at);

-- Pending approvals are counted by status.
CREATE INDEX approval_requests_status ON approval_requests (status, kind);
