
-- =========================================================
-- 1. project_supabase_links: explicit INSERT/UPDATE policies
-- =========================================================
DROP POLICY IF EXISTS "Users insert own project links" ON public.project_supabase_links;
CREATE POLICY "Users insert own project links"
ON public.project_supabase_links
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own project links" ON public.project_supabase_links;
CREATE POLICY "Users update own project links"
ON public.project_supabase_links
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- =========================================================
-- 2. user_supabase_connections: explicit INSERT/UPDATE
-- =========================================================
DROP POLICY IF EXISTS "Users insert own supabase connection" ON public.user_supabase_connections;
CREATE POLICY "Users insert own supabase connection"
ON public.user_supabase_connections
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own supabase connection" ON public.user_supabase_connections;
CREATE POLICY "Users update own supabase connection"
ON public.user_supabase_connections
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- =========================================================
-- 3. support_tickets: column-level restriction via trigger
-- Replace the loose "Users update own tickets limited" policy
-- with a trigger that blocks admin-only column changes.
-- =========================================================
CREATE OR REPLACE FUNCTION public.support_tickets_block_user_admin_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- If the caller is an admin, allow anything.
  IF public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  -- Block changes to admin-only columns by regular users.
  IF NEW.status            IS DISTINCT FROM OLD.status
     OR NEW.priority       IS DISTINCT FROM OLD.priority
     OR NEW.admin_notes    IS DISTINCT FROM OLD.admin_notes
     OR NEW.admin_unread_count IS DISTINCT FROM OLD.admin_unread_count
     OR NEW.closed_at      IS DISTINCT FROM OLD.closed_at
     OR NEW.user_id        IS DISTINCT FROM OLD.user_id
  THEN
    RAISE EXCEPTION 'Users cannot modify admin-only fields on support tickets'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_support_tickets_block_user_admin_columns ON public.support_tickets;
CREATE TRIGGER trg_support_tickets_block_user_admin_columns
BEFORE UPDATE ON public.support_tickets
FOR EACH ROW
EXECUTE FUNCTION public.support_tickets_block_user_admin_columns();
