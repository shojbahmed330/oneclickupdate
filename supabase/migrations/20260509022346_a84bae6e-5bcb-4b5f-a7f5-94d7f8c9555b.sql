CREATE TABLE IF NOT EXISTS public.user_github_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  github_username text NOT NULL,
  github_user_id bigint,
  github_email text,
  access_token_encrypted text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_refreshed_at timestamptz NOT NULL DEFAULT now(),
  revoked boolean NOT NULL DEFAULT false
);

ALTER TABLE public.user_github_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own gh connection" ON public.user_github_connections
  FOR SELECT USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users insert own gh connection" ON public.user_github_connections
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own gh connection" ON public.user_github_connections
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own gh connection" ON public.user_github_connections
  FOR DELETE USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.project_github_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL UNIQUE,
  user_id uuid NOT NULL,
  repo_full_name text NOT NULL,
  default_branch text NOT NULL DEFAULT 'main',
  last_push_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.project_github_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own gh links" ON public.project_github_links
  FOR SELECT USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users insert own gh links" ON public.project_github_links
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own gh links" ON public.project_github_links
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own gh links" ON public.project_github_links
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_project_github_links_project ON public.project_github_links(project_id);
CREATE INDEX IF NOT EXISTS idx_user_github_connections_user ON public.user_github_connections(user_id);