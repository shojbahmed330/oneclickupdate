DROP POLICY IF EXISTS "Users view own supabase connection" ON public.user_supabase_connections;
CREATE POLICY "Users view own supabase connection"
ON public.user_supabase_connections
FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users view own project links" ON public.project_supabase_links;
CREATE POLICY "Users view own project links"
ON public.project_supabase_links
FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users view own supabase op logs" ON public.supabase_operation_logs;
CREATE POLICY "Users view own supabase op logs"
ON public.supabase_operation_logs
FOR SELECT
USING (auth.uid() = user_id);