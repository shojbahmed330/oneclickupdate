
CREATE TABLE IF NOT EXISTS public.project_checkpoints (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL,
  user_id uuid NOT NULL,
  label text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'manual',
  files jsonb NOT NULL DEFAULT '[]'::jsonb,
  file_count integer NOT NULL DEFAULT 0,
  total_bytes integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_checkpoints_project_created
  ON public.project_checkpoints (project_id, created_at DESC);

ALTER TABLE public.project_checkpoints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "checkpoints_owner_select" ON public.project_checkpoints
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "checkpoints_owner_insert" ON public.project_checkpoints
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "checkpoints_owner_delete" ON public.project_checkpoints
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
