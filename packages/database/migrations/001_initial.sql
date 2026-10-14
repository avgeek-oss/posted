CREATE TABLE workspace (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX workspace_singleton ON workspace ((true));

CREATE TABLE users (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash text NOT NULL,
  email_verified boolean NOT NULL DEFAULT false,
  security_epoch integer NOT NULL DEFAULT 0,
  role text NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
  time_zone text NOT NULL DEFAULT 'UTC',
  date_format text NOT NULL DEFAULT 'day-short-month-year' CHECK (date_format IN ('day-short-month-year','short-month-day-year','year-month-day','day-month-year','month-day-year')),
  time_format text NOT NULL DEFAULT '24-hour' CHECK (time_format IN ('24-hour','12-hour','24-hour-seconds','12-hour-seconds')),
  notification_preferences jsonb NOT NULL DEFAULT '{"assignments":true,"mentions":true}',
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  token_hash text NOT NULL UNIQUE,
  security_epoch integer NOT NULL,
  user_agent text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  authenticated_at timestamptz NOT NULL DEFAULT now(),
  passkey_authenticated_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE auth_challenges (
  token_hash text PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  purpose text NOT NULL CHECK (purpose IN ('login', 'reauth', 'registration', 'passkey')),
  challenge text,
  security_epoch integer,
  session_id uuid REFERENCES sessions(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE passkeys (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  public_key bytea NOT NULL,
  counter bigint NOT NULL,
  transports jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX passkeys_user ON passkeys(user_id);

CREATE TABLE recovery_codes (
  user_id uuid NOT NULL REFERENCES users(id),
  code_hash text NOT NULL,
  PRIMARY KEY (user_id, code_hash)
);
CREATE TABLE invitations (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
  token_hash text NOT NULL UNIQUE,
  invited_by uuid NOT NULL REFERENCES users(id),
  verification_required boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE account_recovery (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  reset_mfa boolean NOT NULL DEFAULT false,
  security_epoch integer,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth_rate_limits (
  key text PRIMARY KEY,
  attempts integer NOT NULL,
  window_start timestamptz NOT NULL
);

CREATE TABLE credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  access_level text NOT NULL CHECK(access_level IN ('read','edit')),
  include_admin boolean NOT NULL DEFAULT false,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  token_hash text NOT NULL UNIQUE,
  token_prefix text NOT NULL,
  scopes text[] NOT NULL,
  token_type text NOT NULL DEFAULT 'api-key' CHECK (token_type IN ('api-key','oauth')),
  oauth_client_id text,
  resource text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT credentials_access_shape CHECK (
    (token_type='api-key' AND scopes='{}' AND oauth_client_id IS NULL AND resource IS NULL)
    OR (token_type='oauth' AND user_id IS NOT NULL AND expires_at IS NOT NULL AND scopes <@ ARRAY['read','write','admin']::text[] AND 'read'=ANY(scopes) AND include_admin=('admin'=ANY(scopes)))
  )
);
CREATE INDEX credentials_owner ON credentials(user_id, created_at DESC);

CREATE TABLE oauth_clients (
  id text PRIMARY KEY,
  name text NOT NULL,
  redirect_uris text[] NOT NULL,
  auth_method text NOT NULL CHECK (auth_method IN ('none','client_secret_basic','client_secret_post')),
  secret_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE oauth_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL,
  client_name text NOT NULL,
  client_trust text NOT NULL,
  redirect_uri text NOT NULL,
  resource text NOT NULL,
  scope text NOT NULL,
  state text,
  challenge text NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  approved_role text CHECK(approved_role IN ('viewer','member','admin')),
  reviewed_role text CHECK(reviewed_role IN ('viewer','member','admin')),
  code_hash text UNIQUE,
  credential_id uuid REFERENCES credentials(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT oauth_owner_required CHECK (code_hash IS NULL OR consumed_at IS NOT NULL OR user_id IS NOT NULL)
);
CREATE INDEX oauth_request_expiry ON oauth_requests(expires_at);

CREATE TABLE api_idempotency (
 actor_key text NOT NULL,
 key text NOT NULL,
 request_hash text NOT NULL,
 response jsonb,
 status integer,
 invalidation_reason text CHECK (invalidation_reason IN ('deleted','upgrade','access')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_key,key)
);
CREATE TABLE request_limits (
 key text PRIMARY KEY,
 count integer NOT NULL,
 reset_at timestamptz NOT NULL
);



CREATE FUNCTION lock_workspace_authority() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM id FROM workspace FOR UPDATE; RETURN NULL; END;
$$;
CREATE TRIGGER credentials_authority BEFORE INSERT OR UPDATE OR DELETE ON credentials FOR EACH STATEMENT EXECUTE FUNCTION lock_workspace_authority();
CREATE TRIGGER oauth_authority BEFORE INSERT OR UPDATE OR DELETE ON oauth_requests FOR EACH STATEMENT EXECUTE FUNCTION lock_workspace_authority();
CREATE TRIGGER users_authority BEFORE INSERT OR UPDATE OR DELETE ON users FOR EACH STATEMENT EXECUTE FUNCTION lock_workspace_authority();
CREATE FUNCTION revoke_changed_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.role IS DISTINCT FROM OLD.role OR NEW.disabled_at IS DISTINCT FROM OLD.disabled_at THEN
  UPDATE credentials SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=NEW.id AND (token_type='oauth' OR NEW.disabled_at IS NOT NULL);
  UPDATE oauth_requests SET consumed_at=COALESCE(consumed_at,now()),expires_at=LEAST(expires_at,now()) WHERE user_id=NEW.id AND consumed_at IS NULL;
  IF NEW.role='viewer' THEN UPDATE credentials SET access_level='read',include_admin=false WHERE user_id=NEW.id AND token_type='api-key';
  ELSIF NEW.role='member' THEN UPDATE credentials SET include_admin=false WHERE user_id=NEW.id AND token_type='api-key'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER changed_identity AFTER UPDATE OF role,disabled_at ON users FOR EACH ROW EXECUTE FUNCTION revoke_changed_identity();
CREATE TABLE email_requests (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  invitation_id uuid REFERENCES invitations(id),
  purpose text NOT NULL CHECK (purpose IN ('verification','change','invitation')),
  email text NOT NULL,
  previous_email text,
  security_epoch integer NOT NULL,
  token_hash text,
  code_hash text,
  proof_hash text,
  verified_name text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((purpose='invitation' AND invitation_id IS NOT NULL AND user_id IS NULL) OR (purpose<>'invitation' AND user_id IS NOT NULL AND invitation_id IS NULL))
);
CREATE UNIQUE INDEX email_requests_user_purpose ON email_requests(user_id,purpose) WHERE consumed_at IS NULL;
CREATE UNIQUE INDEX email_requests_invitation ON email_requests(invitation_id) WHERE consumed_at IS NULL;
CREATE TABLE email_outbox (
  id uuid PRIMARY KEY,
  request_id uuid REFERENCES email_requests(id),
  invitation_id uuid REFERENCES invitations(id),
  recovery_hash text,
  payload text,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','delivered','cancelled','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  available_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  lease_token uuid,
  lease_until timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  CHECK (num_nonnulls(request_id,invitation_id,recovery_hash)=1),
  CHECK ((lease_token IS NULL)=(lease_until IS NULL))
);
CREATE INDEX email_outbox_pending ON email_outbox(available_at,created_at) WHERE state='pending';
