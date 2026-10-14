CREATE TABLE post_edit_requests (
 workspace_id uuid NOT NULL REFERENCES workspace(id),
 idempotency_key text NOT NULL,
 group_id uuid NOT NULL REFERENCES post_groups(id),
 request_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,idempotency_key)
);
