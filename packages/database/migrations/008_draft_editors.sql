ALTER TABLE post_drafts ADD COLUMN last_edited_by uuid REFERENCES users(id);
UPDATE post_drafts SET last_edited_by=created_by WHERE version=1;
