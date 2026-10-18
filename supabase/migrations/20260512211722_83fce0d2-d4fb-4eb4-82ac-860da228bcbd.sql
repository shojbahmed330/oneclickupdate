CREATE TABLE IF NOT EXISTS public.daytona_warm_pool (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'ready',
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_warm_pool_status_created
  ON public.daytona_warm_pool (status, created_at);

ALTER TABLE public.daytona_warm_pool ENABLE ROW LEVEL SECURITY;

-- No policies = service-role-only access (anon/authenticated cannot read/write).
-- This is intentional; the table is internal infrastructure managed by edge functions.