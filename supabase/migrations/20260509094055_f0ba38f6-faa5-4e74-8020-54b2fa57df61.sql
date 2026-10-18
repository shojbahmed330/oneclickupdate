-- App branding (per-project) — name, package id, version, logo, splash
CREATE TABLE public.app_branding (
  project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  app_name text NOT NULL DEFAULT 'My App',
  package_id text NOT NULL,
  version_name text NOT NULL DEFAULT '1.0.0',
  version_code integer NOT NULL DEFAULT 1,
  logo_path text,
  splash_path text,
  splash_bg_color text DEFAULT '#FFFFFF',
  adaptive_bg_color text DEFAULT '#FFFFFF',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_branding ENABLE ROW LEVEL SECURITY;

CREATE POLICY "branding_select_own" ON public.app_branding
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "branding_insert_own" ON public.app_branding
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "branding_update_own" ON public.app_branding
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "branding_delete_own" ON public.app_branding
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER trg_app_branding_updated_at
  BEFORE UPDATE ON public.app_branding
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Snapshot branding refs onto app_builds for reproducibility
ALTER TABLE public.app_builds
  ADD COLUMN IF NOT EXISTS logo_path text,
  ADD COLUMN IF NOT EXISTS splash_path text,
  ADD COLUMN IF NOT EXISTS adaptive_bg_color text,
  ADD COLUMN IF NOT EXISTS splash_bg_color text;

-- Private storage bucket for logo/splash assets
INSERT INTO storage.buckets (id, name, public)
  VALUES ('app-branding', 'app-branding', false)
  ON CONFLICT (id) DO NOTHING;

-- RLS: path = {user_id}/{project_id}/{file}
CREATE POLICY "branding_files_owner_select" ON storage.objects
  FOR SELECT USING (bucket_id = 'app-branding' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "branding_files_owner_insert" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'app-branding' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "branding_files_owner_update" ON storage.objects
  FOR UPDATE USING (bucket_id = 'app-branding' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "branding_files_owner_delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'app-branding' AND auth.uid()::text = (storage.foldername(name))[1]);