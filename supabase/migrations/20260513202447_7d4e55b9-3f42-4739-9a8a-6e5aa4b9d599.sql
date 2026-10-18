DROP POLICY IF EXISTS "Users view own gh connection" ON public.user_github_connections;
CREATE POLICY "Users view own gh connection"
ON public.user_github_connections
FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users view own gh links" ON public.project_github_links;
CREATE POLICY "Users view own gh links"
ON public.project_github_links
FOR SELECT
USING (auth.uid() = user_id);