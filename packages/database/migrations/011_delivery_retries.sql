ALTER TABLE post_deliveries ADD COLUMN retry_attempts integer NOT NULL DEFAULT 0 CHECK(retry_attempts>=0);
UPDATE post_deliveries SET retry_attempts=LEAST(attempts,5);

CREATE TABLE post_resume_requests (
 workspace_id uuid NOT NULL REFERENCES workspace(id),
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 128),
 group_id uuid NOT NULL,
 connection_id uuid NOT NULL,
 request_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,idempotency_key),
 FOREIGN KEY(group_id,workspace_id) REFERENCES post_groups(id,workspace_id) ON DELETE CASCADE,
 FOREIGN KEY(connection_id,workspace_id) REFERENCES social_connections(id,workspace_id)
);
