-- 2026-06-11: allow uploading a broadcast image file (not just a remote URL).
--
-- Storage model mirrors support-ticket attachments: the image bytes live as
-- BYTEA directly in Postgres. The Hostman container filesystem is wiped on
-- every redeploy (stateless Docker, no persistent volume), so we cannot keep
-- uploaded files on disk; bytea persists and is cheap at the current scale.
--
-- Flow: when an admin uploads a file, app/api/admin/broadcasts POST stores the
-- bytes in image_data/image_mime, then sets image_url to our public serving
-- route (https://<app>/api/broadcasts/<id>/image). The bot keeps using
-- URLInputFile(image_url) with no changes — it just fetches the image from us.
-- A plain remote image_url (legacy "paste a link") still works untouched.
--
-- Idempotent.

ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS image_data BYTEA;
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS image_mime TEXT;
