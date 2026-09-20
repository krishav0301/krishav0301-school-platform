-- Notifications and jobs (D-031).
--
-- The outbox already exists (0001). It gains what a job runner needs: a due time for retries, a
-- lease so two runners never send the same message, a give-up time, and a unique key so the same
-- event can never be queued twice. Anything secret in a payload is sealed (encrypted with a Worker
-- secret) before it is written, so a copy of this table cannot be used to take over an account.

ALTER TABLE outbox_events ADD COLUMN dedupe_key TEXT;
ALTER TABLE outbox_events ADD COLUMN next_attempt_at TEXT;
ALTER TABLE outbox_events ADD COLUMN claimed_until TEXT;
ALTER TABLE outbox_events ADD COLUMN dead_at TEXT;

CREATE UNIQUE INDEX outbox_dedupe ON outbox_events (dedupe_key) WHERE dedupe_key IS NOT NULL;

DROP INDEX outbox_unprocessed;
CREATE INDEX outbox_due ON outbox_events (next_attempt_at) WHERE processed_at IS NULL AND dead_at IS NULL;

-- Where the "dev" email adapter puts messages, so development and staging can read what would have
-- been sent without an email provider. Refused in production (core/environment.ts).
CREATE TABLE dev_mailbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL
);
