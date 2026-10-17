ALTER TABLE post_groups ADD COLUMN additional_posts jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(additional_posts)='array');
ALTER TABLE post_drafts ADD COLUMN additional_posts jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(additional_posts)='array');

ALTER TABLE post_deliveries ADD COLUMN post_index integer NOT NULL DEFAULT 0 CHECK(post_index>=0);
ALTER TABLE post_deliveries ADD COLUMN provider_post_cid text;
ALTER TABLE post_deliveries DROP CONSTRAINT post_deliveries_group_id_connection_id_key;
ALTER TABLE post_deliveries ADD UNIQUE(group_id,connection_id,post_index);
CREATE INDEX post_delivery_sequence ON post_deliveries(group_id,connection_id,post_index,state);

ALTER TABLE post_group_media ADD COLUMN post_index integer NOT NULL DEFAULT 0 CHECK(post_index>=0);
ALTER TABLE post_group_media DROP CONSTRAINT post_group_images_pkey;
ALTER TABLE post_group_media DROP CONSTRAINT post_group_images_group_id_position_key;
ALTER TABLE post_group_media ADD PRIMARY KEY(group_id,post_index,media_id);
ALTER TABLE post_group_media ADD UNIQUE(group_id,post_index,position);

ALTER TABLE post_draft_media ADD COLUMN post_index integer NOT NULL DEFAULT 0 CHECK(post_index>=0);
ALTER TABLE post_draft_media DROP CONSTRAINT post_draft_images_pkey;
ALTER TABLE post_draft_media DROP CONSTRAINT post_draft_images_draft_id_position_key;
ALTER TABLE post_draft_media ADD PRIMARY KEY(draft_id,post_index,media_id);
ALTER TABLE post_draft_media ADD UNIQUE(draft_id,post_index,position);
