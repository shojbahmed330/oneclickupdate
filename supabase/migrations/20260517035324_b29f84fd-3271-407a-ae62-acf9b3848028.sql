-- Design references: stores approved mobile HTML prototype per project.
-- Agent fetches via `get_design_reference` tool instead of carrying HTML in chat history.
CREATE TABLE IF NOT EXISTS public.design_references (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL UNIQUE REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  prompt TEXT NOT NULL,
  html TEXT NOT NULL,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.design_references ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner can read design_reference"
  ON public.design_references FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "owner can insert design_reference"
  ON public.design_references FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "owner can update design_reference"
  ON public.design_references FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "owner can delete design_reference"
  ON public.design_references FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER trg_design_references_updated_at
BEFORE UPDATE ON public.design_references
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();