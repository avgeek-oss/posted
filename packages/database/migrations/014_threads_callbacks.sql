ALTER TABLE social_oauth_requests ADD COLUMN created_at timestamptz NOT NULL DEFAULT '1970-01-01T00:00:00Z';
ALTER TABLE social_oauth_requests ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE post_deliveries ADD COLUMN retry_cancelled_at timestamptz;

CREATE TABLE threads_account_events (
 request_hash text PRIMARY KEY,
 subject_hash text NOT NULL,
 action text NOT NULL CHECK(action IN ('deauthorize','delete')),
 issued_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),
 confirmation_code text UNIQUE,
 CHECK((action='delete')=(confirmation_code IS NOT NULL))
);
CREATE INDEX threads_account_event_subject ON threads_account_events(subject_hash,received_at DESC);
