
DO $$ BEGIN
  CREATE TYPE public.agent_secret_request_status AS ENUM ('pending','provided','declined','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.agent_secret_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  run_id uuid,
  secret_name text NOT NULL,
  label text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  why_needed text NOT NULL DEFAULT '',
  link_hint text NOT NULL DEFAULT '',
  doc_url text NOT NULL DEFAULT '',
  status public.agent_secret_request_status NOT NULL DEFAULT 'pending',
  fulfilled_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_secret_requests_project ON public.agent_secret_requests(project_id, status, created_at DESC);

ALTER TABLE public.agent_secret_requests ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "secret_requests_self_select" ON public.agent_secret_requests
    FOR SELECT TO authenticated USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "secret_requests_self_update" ON public.agent_secret_requests
    FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP TRIGGER IF EXISTS tg_agent_secret_requests_updated_at ON public.agent_secret_requests;
CREATE TRIGGER tg_agent_secret_requests_updated_at
  BEFORE UPDATE ON public.agent_secret_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_secret_requests;
ALTER TABLE public.agent_secret_requests REPLICA IDENTITY FULL;
