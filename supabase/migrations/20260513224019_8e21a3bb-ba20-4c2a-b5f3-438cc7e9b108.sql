-- Track which artifact was requested for each build.
-- apk-debug    = unsigned/debug-signed APK for sideload testing
-- apk-release  = signed release APK (shareable, not Play Store)
-- aab-release  = signed AAB for Google Play Store upload only
ALTER TABLE public.app_builds
  ADD COLUMN IF NOT EXISTS build_target text;

-- Backfill existing rows from signing_mode for consistency.
UPDATE public.app_builds
SET build_target = CASE
  WHEN signing_mode = 'release' THEN 'apk-release'
  ELSE 'apk-debug'
END
WHERE build_target IS NULL;

-- Loose CHECK constraint (no time-based logic, immutable, safe).
ALTER TABLE public.app_builds
  DROP CONSTRAINT IF EXISTS app_builds_build_target_check;
ALTER TABLE public.app_builds
  ADD CONSTRAINT app_builds_build_target_check
  CHECK (build_target IS NULL OR build_target IN ('apk-debug','apk-release','aab-release'));