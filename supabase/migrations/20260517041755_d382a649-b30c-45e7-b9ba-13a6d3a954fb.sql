
ALTER TABLE public.design_references
  ADD COLUMN IF NOT EXISTS screen_key text NOT NULL DEFAULT 'main',
  ADD COLUMN IF NOT EXISTS screen_label text NOT NULL DEFAULT 'Main',
  ADD COLUMN IF NOT EXISTS screen_index integer NOT NULL DEFAULT 0;

ALTER TABLE public.design_references
  DROP CONSTRAINT IF EXISTS design_references_project_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS design_references_project_screen_uniq
  ON public.design_references (project_id, screen_key);

CREATE INDEX IF NOT EXISTS design_references_project_idx
  ON public.design_references (project_id, screen_index);
