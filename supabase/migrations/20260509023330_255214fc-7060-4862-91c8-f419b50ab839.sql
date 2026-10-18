ALTER TABLE public.chat_messages 
  ADD COLUMN IF NOT EXISTS run_id text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'complete';

CREATE INDEX IF NOT EXISTS idx_chat_messages_run_id ON public.chat_messages(run_id) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_messages_project_status ON public.chat_messages(project_id, status) WHERE status <> 'complete';