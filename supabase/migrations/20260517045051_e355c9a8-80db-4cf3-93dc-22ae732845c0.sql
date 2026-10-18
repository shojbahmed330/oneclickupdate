
DO $$ BEGIN
  CREATE TYPE public.connector_proposal_status AS ENUM ('pending','selected','cancelled','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.connector_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  run_id uuid,
  need_description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  selected_option_index int,
  status public.connector_proposal_status NOT NULL DEFAULT 'pending',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_connector_proposals_project ON public.connector_proposals(project_id, status, created_at DESC);

ALTER TABLE public.connector_proposals ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "connector_proposals_self_select" ON public.connector_proposals
    FOR SELECT TO authenticated USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "connector_proposals_self_update" ON public.connector_proposals
    FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP TRIGGER IF EXISTS tg_connector_proposals_updated_at ON public.connector_proposals;
CREATE TRIGGER tg_connector_proposals_updated_at
  BEFORE UPDATE ON public.connector_proposals
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.connector_proposals;
ALTER TABLE public.connector_proposals REPLICA IDENTITY FULL;
