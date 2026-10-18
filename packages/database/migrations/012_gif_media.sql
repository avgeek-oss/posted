ALTER TABLE post_media DROP CONSTRAINT post_media_content_check;
ALTER TABLE post_media ADD CONSTRAINT post_media_content_check CHECK(content_type IN ('image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime'));
ALTER TABLE post_media ADD COLUMN thumbnail_object_key text;
