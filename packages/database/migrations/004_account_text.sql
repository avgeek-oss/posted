ALTER TABLE post_deliveries ADD COLUMN text_override text CHECK(length(text_override)<=3000);
