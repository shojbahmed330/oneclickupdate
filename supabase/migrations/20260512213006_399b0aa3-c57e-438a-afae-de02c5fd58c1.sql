
-- Background tasks: long-running agent jobs that run while the user is away.
CREATE TABLE IF NOT EXISTS public.background_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  project_id UUID NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | running | done | error
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  result JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_background_tasks_pending
  ON public.background_tasks (status, scheduled_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_background_tasks_user
  ON public.background_tasks (user_id, created_at DESC);

ALTER TABLE public.background_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_select_bg_tasks"
  ON public.background_tasks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "owner_insert_bg_tasks"
  ON public.background_tasks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "owner_update_bg_tasks"
  ON public.background_tasks FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "owner_delete_bg_tasks"
  ON public.background_tasks FOR DELETE
  USING (auth.uid() = user_id);
