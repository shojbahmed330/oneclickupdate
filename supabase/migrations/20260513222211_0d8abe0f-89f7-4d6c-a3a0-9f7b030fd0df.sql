-- Make the apk-builds bucket private. APK download URLs are now issued
-- as 7-day signed URLs from the build-upload-apk and build-status edge
-- functions; direct unauthenticated downloads are no longer possible.
UPDATE storage.buckets SET public = false WHERE id = 'apk-builds';