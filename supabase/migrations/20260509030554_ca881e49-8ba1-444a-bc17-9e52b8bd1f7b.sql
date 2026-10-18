CREATE TABLE IF NOT EXISTS public.project_publish_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  user_id uuid NOT NULL,
  environment text NOT NULL DEFAULT 'production',
  custom_domain text NOT NULL DEFAULT '',
  is_published boolean NOT NULL DEFAULT false,
  last_published_at timestamptz,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, environment)
);

ALTER TABLE public.project_publish_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own publish configs" ON public.project_publish_configs
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own publish configs" ON public.project_publish_configs
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own publish configs" ON public.project_publish_configs
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own publish configs" ON public.project_publish_configs
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_project_publish_configs_updated_at
  BEFORE UPDATE ON public.project_publish_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_project_publish_configs_project ON public.project_publish_configs(project_id);