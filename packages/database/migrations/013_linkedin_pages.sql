ALTER TABLE social_connections DROP CONSTRAINT social_connections_provider_check;
ALTER TABLE social_connections ADD CONSTRAINT social_connections_provider_check CHECK(provider IN ('x','linkedin','linkedin-pages','bluesky','threads'));
ALTER TABLE social_oauth_requests DROP CONSTRAINT social_oauth_requests_provider_check;
ALTER TABLE social_oauth_requests ADD CONSTRAINT social_oauth_requests_provider_check CHECK(provider IN ('x','linkedin','linkedin-pages','bluesky','threads'));
CREATE TABLE linkedin_page_authorizations (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES workspace(id),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 encrypted_grant text NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes'
);
CREATE INDEX linkedin_page_authorizations_expiry ON linkedin_page_authorizations(expires_at);
