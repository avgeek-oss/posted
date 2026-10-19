ALTER TABLE social_connections DROP CONSTRAINT social_connections_provider_check;
ALTER TABLE social_connections ADD CONSTRAINT social_connections_provider_check CHECK(provider IN ('x','linkedin','linkedin-pages','facebook-pages','instagram','bluesky','threads'));
ALTER TABLE social_oauth_requests DROP CONSTRAINT social_oauth_requests_provider_check;
ALTER TABLE social_oauth_requests ADD CONSTRAINT social_oauth_requests_provider_check CHECK(provider IN ('x','linkedin','linkedin-pages','facebook-pages','instagram','bluesky','threads'));
ALTER TABLE social_connections ADD COLUMN instagram_subject_hash text;
CREATE INDEX social_connections_instagram_subject ON social_connections(instagram_subject_hash) WHERE provider='instagram';
CREATE TABLE instagram_account_events (
 request_hash text PRIMARY KEY,
 subject_hash text NOT NULL,
 action text NOT NULL CHECK(action IN ('deauthorize','delete')),
 issued_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 confirmation_code text UNIQUE,
 CHECK((action='delete')=(confirmation_code IS NOT NULL))
);
CREATE INDEX instagram_account_events_subject ON instagram_account_events(subject_hash,received_at);
