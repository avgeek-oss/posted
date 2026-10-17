CREATE TABLE post_group_media_overrides (
 group_id uuid NOT NULL,
 workspace_id uuid NOT NULL,
 post_index integer NOT NULL CHECK(post_index>=0),
 connection_id uuid NOT NULL,
 PRIMARY KEY(group_id,post_index,connection_id),
 UNIQUE(group_id,post_index,connection_id,workspace_id),
 FOREIGN KEY(group_id,workspace_id) REFERENCES post_groups(id,workspace_id) ON DELETE CASCADE,
 FOREIGN KEY(connection_id,workspace_id) REFERENCES social_connections(id,workspace_id)
);
CREATE TABLE post_group_account_media (
 group_id uuid NOT NULL,
 workspace_id uuid NOT NULL,
 post_index integer NOT NULL,
 connection_id uuid NOT NULL,
 media_id uuid NOT NULL,
 position integer NOT NULL CHECK(position BETWEEN 0 AND 19),
 PRIMARY KEY(group_id,post_index,connection_id,media_id),
 UNIQUE(group_id,post_index,connection_id,position),
 FOREIGN KEY(group_id,post_index,connection_id,workspace_id) REFERENCES post_group_media_overrides(group_id,post_index,connection_id,workspace_id) ON DELETE CASCADE,
 FOREIGN KEY(media_id,workspace_id) REFERENCES post_media(id,workspace_id)
);
CREATE TABLE post_draft_media_overrides (
 draft_id uuid NOT NULL,
 workspace_id uuid NOT NULL,
 post_index integer NOT NULL CHECK(post_index>=0),
 connection_id uuid NOT NULL,
 PRIMARY KEY(draft_id,post_index,connection_id),
 UNIQUE(draft_id,post_index,connection_id,workspace_id),
 FOREIGN KEY(draft_id,workspace_id) REFERENCES post_drafts(id,workspace_id) ON DELETE CASCADE,
 FOREIGN KEY(connection_id,workspace_id) REFERENCES social_connections(id,workspace_id)
);
CREATE TABLE post_draft_account_media (
 draft_id uuid NOT NULL,
 workspace_id uuid NOT NULL,
 post_index integer NOT NULL,
 connection_id uuid NOT NULL,
 media_id uuid NOT NULL,
 position integer NOT NULL CHECK(position BETWEEN 0 AND 19),
 PRIMARY KEY(draft_id,post_index,connection_id,media_id),
 UNIQUE(draft_id,post_index,connection_id,position),
 FOREIGN KEY(draft_id,post_index,connection_id,workspace_id) REFERENCES post_draft_media_overrides(draft_id,post_index,connection_id,workspace_id) ON DELETE CASCADE,
 FOREIGN KEY(media_id,workspace_id) REFERENCES post_media(id,workspace_id)
);
