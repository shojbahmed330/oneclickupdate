
-- ── User keystores ────────────────────────────────────────────────────
-- One keystore per user. Play Store rule: an app's signing key is forever.
-- Once a keystore is uploaded to Play Console, every future update MUST be
-- signed with the same key — losing it means the app cannot be updated.
CREATE TABLE IF NOT EXISTS public.user_keystores (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE,
  alias text NOT NULL DEFAULT 'app',
  -- AES-GCM ciphertext (base64) — passwords are NEVER stored in plaintext.
  store_password_encrypted text NOT NULL,
  key_password_encrypted text NOT NULL,
  -- Path inside the private 'keystores' storage bucket.
  storage_path text,
  sha1_fingerprint text,
  sha256_fingerprint text,
  validity_years integer NOT NULL DEFAULT 30,
  full_name text NOT NULL DEFAULT 'App Owner',
  org_name text NOT NULL DEFAULT 'Lovable User',
  org_unit text NOT NULL DEFAULT 'Apps',
  city text NOT NULL DEFAULT 'NA',
  state text NOT NULL DEFAULT 'NA',
  country text NOT NULL DEFAULT 'US',
  status text NOT NULL DEFAULT 'pending', -- pending | ready | failed
  generated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_keystores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own keystore" ON public.user_keystores
  FOR SELECT USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users insert own keystore" ON public.user_keystores
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own keystore" ON public.user_keystores
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users delete own keystore" ON public.user_keystores
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER trg_user_keystores_updated_at
BEFORE UPDATE ON public.user_keystores
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Build columns: signing mode + dual artifact URLs ──────────────────
ALTER TABLE public.app_builds
  ADD COLUMN IF NOT EXISTS signing_mode text NOT NULL DEFAULT 'debug', -- 'debug' | 'release'
  ADD COLUMN IF NOT EXISTS aab_download_url text,
  ADD COLUMN IF NOT EXISTS keystore_sha1 text;

-- ── Private storage bucket for keystores ──────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('keystores', 'keystores', false)
ON CONFLICT (id) DO NOTHING;

-- Only the user (or admin / service-role) can read/write their keystore.
-- Path convention: '<user_id>/app.jks'
DROP POLICY IF EXISTS "Users read own keystore file" ON storage.objects;
CREATE POLICY "Users read own keystore file" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'keystores'
    AND (auth.uid()::text = (storage.foldername(name))[1] OR public.has_role(auth.uid(), 'admin'))
  );

DROP POLICY IF EXISTS "Users write own keystore file" ON storage.objects;
CREATE POLICY "Users write own keystore file" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'keystores'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users update own keystore file" ON storage.objects;
CREATE POLICY "Users update own keystore file" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'keystores'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users delete own keystore file" ON storage.objects;
CREATE POLICY "Users delete own keystore file" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'keystores'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
