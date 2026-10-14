CREATE TABLE social_connections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspace(id),
 provider text NOT NULL CHECK(provider IN ('x','linkedin','bluesky','threads')),
 account_id text NOT NULL,
 name text NOT NULL,
 handle text NOT NULL,
 avatar_url text,
 encrypted_credentials text NOT NULL,
 state text NOT NULL DEFAULT 'connected' CHECK(state IN ('connected','reauthentication_required','disconnected')),
 connected_by uuid REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,provider,account_id),
 UNIQUE(id,workspace_id)
);
CREATE TABLE social_oauth_requests (
 state_hash text PRIMARY KEY,
 provider text NOT NULL CHECK(provider IN ('x','linkedin','bluesky','threads')),
 workspace_id uuid NOT NULL REFERENCES workspace(id),
 user_id uuid NOT NULL REFERENCES users(id),
 encrypted_verifier text NOT NULL,
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz
);
CREATE TABLE bluesky_oauth_state (key text PRIMARY KEY, value text NOT NULL, expires_at timestamptz NOT NULL);
CREATE TABLE bluesky_oauth_sessions (key text PRIMARY KEY, value text NOT NULL);
CREATE TABLE post_images (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspace(id),
 created_by uuid REFERENCES users(id),
 object_key text NOT NULL UNIQUE,
 file_name text NOT NULL,
 content_type text NOT NULL,
 size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 20971520),
 width integer,
 height integer,
 alt text NOT NULL DEFAULT '' CHECK(length(alt)<=2000),
 state text NOT NULL DEFAULT 'uploading' CHECK(state IN ('uploading','ready','deleted')),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,workspace_id)
);
CREATE TABLE post_groups (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspace(id),
 created_by uuid REFERENCES users(id),
 text text NOT NULL CHECK(length(text)<=3000),
 scheduled_at timestamptz NOT NULL,
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 128),
 request_hash text NOT NULL,
 version integer NOT NULL DEFAULT 1,
 cancelled_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,idempotency_key),
 UNIQUE(id,workspace_id)
);
CREATE TABLE post_group_images (
 group_id uuid NOT NULL,
 image_id uuid NOT NULL,
 workspace_id uuid NOT NULL REFERENCES workspace(id),
 position integer NOT NULL CHECK(position>=0),
 PRIMARY KEY(group_id,image_id),
 UNIQUE(group_id,position),
 FOREIGN KEY(group_id,workspace_id) REFERENCES post_groups(id,workspace_id) ON DELETE CASCADE,
 FOREIGN KEY(image_id,workspace_id) REFERENCES post_images(id,workspace_id)
);
CREATE TABLE post_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 group_id uuid NOT NULL,
 workspace_id uuid NOT NULL REFERENCES workspace(id),
 connection_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'scheduled' CHECK(state IN ('scheduled','preparing','publishing','published','failed','uncertain','cancelled')),
 attempts integer NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL,
 lease_token uuid,
 lease_until timestamptz,
 provider_post_id text,
 published_url text,
 error text,
 provider_checkpoint jsonb,
 published_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(group_id,connection_id),
 FOREIGN KEY(group_id,workspace_id) REFERENCES post_groups(id,workspace_id) ON DELETE CASCADE,
 FOREIGN KEY(connection_id,workspace_id) REFERENCES social_connections(id,workspace_id),
 CHECK((lease_token IS NULL)=(lease_until IS NULL))
);
CREATE INDEX post_queue ON post_deliveries(available_at,created_at) WHERE state='scheduled';
CREATE INDEX post_group_schedule ON post_groups(workspace_id,scheduled_at,id);
CREATE INDEX post_group_deliveries ON post_deliveries(group_id);
