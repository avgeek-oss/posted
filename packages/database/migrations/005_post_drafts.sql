CREATE TABLE post_drafts (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES workspace(id),
 created_by uuid REFERENCES users(id),
 text text NOT NULL CHECK(length(text)<=64000),
 text_overrides jsonb NOT NULL DEFAULT '{}',
 connection_ids uuid[] NOT NULL DEFAULT '{}',
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 idempotency_key text NOT NULL,
 request_hash text NOT NULL,
 published_post_id uuid REFERENCES post_groups(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,workspace_id)
);
CREATE INDEX post_draft_list ON post_drafts(workspace_id,updated_at DESC,id) WHERE published_post_id IS NULL;
CREATE TABLE post_draft_images (
 draft_id uuid NOT NULL,
 image_id uuid NOT NULL,
 workspace_id uuid NOT NULL REFERENCES workspace(id),
 position integer NOT NULL CHECK(position>=0),
 PRIMARY KEY(draft_id,image_id),
 UNIQUE(draft_id,position),
 FOREIGN KEY(draft_id,workspace_id) REFERENCES post_drafts(id,workspace_id) ON DELETE CASCADE,
 FOREIGN KEY(image_id,workspace_id) REFERENCES post_images(id,workspace_id)
);
