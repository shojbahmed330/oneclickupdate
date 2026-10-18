
-- =========================================================
-- apk-builds: replace broad public SELECT with owner-scoped
-- File path convention: <user_id>/<...>
-- =========================================================
DROP POLICY IF EXISTS "apk_builds_public_read" ON storage.objects;

CREATE POLICY "apk_builds_owner_read"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'apk-builds'
  AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  )
);

-- =========================================================
-- avatars: replace broad public SELECT with owner-scoped
-- Public bucket → direct file URLs still work without auth.
-- Only the storage API list/get is restricted.
-- =========================================================
DROP POLICY IF EXISTS "Avatar images are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Avatars are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Public avatars read" ON storage.objects;
DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;

CREATE POLICY "avatars_owner_or_admin_read"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'avatars'
  AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  )
);
