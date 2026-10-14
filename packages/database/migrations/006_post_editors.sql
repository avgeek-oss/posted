ALTER TABLE post_groups ADD COLUMN last_edited_by uuid REFERENCES users(id);
UPDATE post_groups SET last_edited_by=created_by WHERE version=1 AND cancelled_at IS NULL;
