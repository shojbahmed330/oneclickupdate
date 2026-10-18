
-- Wipe all builder data for clean start
TRUNCATE TABLE public.chat_messages CASCADE;
TRUNCATE TABLE public.project_files CASCADE;
TRUNCATE TABLE public.app_builds CASCADE;
TRUNCATE TABLE public.projects CASCADE;

-- Drop legacy tables/columns no longer needed
DROP TABLE IF EXISTS public.project_error_history CASCADE;

-- Add AI SDK message parts column
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS parts JSONB DEFAULT '[]'::jsonb;

-- Track per-project Daytona workspaces
CREATE TABLE IF NOT EXISTS public.daytona_workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL UNIQUE REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  workspace_id TEXT NOT NULL,
  preview_url TEXT,
  status TEXT NOT NULL DEFAULT 'creating',
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.daytona_workspaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own workspaces"
  ON public.daytona_workspaces FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own workspaces"
  ON public.daytona_workspaces FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own workspaces"
  ON public.daytona_workspaces FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own workspaces"
  ON public.daytona_workspaces FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_daytona_workspaces_project ON public.daytona_workspaces(project_id);
CREATE INDEX IF NOT EXISTS idx_daytona_workspaces_user ON public.daytona_workspaces(user_id);

CREATE TRIGGER update_daytona_workspaces_updated_at
  BEFORE UPDATE ON public.daytona_workspaces
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Drop legacy agent version preference (no longer relevant)
DROP FUNCTION IF EXISTS public.get_agent_version_preference() CASCADE;
DROP FUNCTION IF EXISTS public.set_agent_version_preference(boolean) CASCADE;
DELETE FROM public.feature_flags WHERE flag_key = 'prefer_agent_v2';
