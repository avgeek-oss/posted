ALTER TABLE social_connections DROP CONSTRAINT social_connections_provider_check;
ALTER TABLE social_connections ADD CONSTRAINT social_connections_provider_check CHECK(provider IN ('x','linkedin','linkedin-pages','facebook-pages','bluesky','threads'));
ALTER TABLE social_oauth_requests DROP CONSTRAINT social_oauth_requests_provider_check;
ALTER TABLE social_oauth_requests ADD CONSTRAINT social_oauth_requests_provider_check CHECK(provider IN ('x','linkedin','linkedin-pages','facebook-pages','bluesky','threads'));
ALTER TABLE social_connections ADD COLUMN facebook_subject_hash text;
CREATE INDEX social_connections_facebook_subject ON social_connections(facebook_subject_hash) WHERE provider='facebook-pages';
CREATE TABLE facebook_page_authorizations (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES workspace(id),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 subject_hash text NOT NULL,
 encrypted_grant text NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes'
);
CREATE INDEX facebook_page_authorizations_expiry ON facebook_page_authorizations(expires_at);
CREATE TABLE facebook_account_events (
 request_hash text PRIMARY KEY,
 subject_hash text NOT NULL,
 action text NOT NULL CHECK(action IN ('deauthorize','delete')),
 issued_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 confirmation_code text UNIQUE,
 CHECK((action='delete')=(confirmation_code IS NOT NULL))
);
CREATE INDEX facebook_account_events_subject ON facebook_account_events(subject_hash,received_at);
