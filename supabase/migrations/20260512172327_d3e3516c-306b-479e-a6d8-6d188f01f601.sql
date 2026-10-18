ALTER TABLE public.project_memory
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'topical'
    CHECK (scope IN ('core', 'topical', 'user')),
  ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.project_memory
  ALTER COLUMN project_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS project_memory_scope_idx
  ON public.project_memory (user_id, scope, archived, weight DESC, last_used_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS project_memory_dedupe_idx
  ON public.project_memory (user_id, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(content));