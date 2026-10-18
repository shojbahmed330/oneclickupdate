-- Allow admins to read all daytona workspace rows for usage tracking.
CREATE POLICY "Admins view all workspaces"
ON public.daytona_workspaces
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));