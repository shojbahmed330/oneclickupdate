
-- pg_net does not support ALTER EXTENSION SET SCHEMA, so we drop + recreate
-- in the extensions schema. The functional API lives in the `net` schema
-- which is recreated identically, so callers (net.http_post, net.http_get…)
-- continue to work unchanged.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pg_net' AND n.nspname = 'public'
  ) THEN
    CREATE SCHEMA IF NOT EXISTS extensions;
    EXECUTE 'DROP EXTENSION pg_net';
    EXECUTE 'CREATE EXTENSION pg_net WITH SCHEMA extensions';
  END IF;
END
$$;
