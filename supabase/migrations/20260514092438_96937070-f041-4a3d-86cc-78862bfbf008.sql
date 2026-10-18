
-- 1) Bucket
insert into storage.buckets (id, name, public)
values ('support-attachments', 'support-attachments', false)
on conflict (id) do nothing;

-- 2) Storage policies
drop policy if exists "support attach insert own" on storage.objects;
create policy "support attach insert own"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'support-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "support attach select own" on storage.objects;
create policy "support attach select own"
on storage.objects for select to authenticated
using (
  bucket_id = 'support-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "support attach select admin" on storage.objects;
create policy "support attach select admin"
on storage.objects for select to authenticated
using (
  bucket_id = 'support-attachments'
  AND public.has_role(auth.uid(), 'admin')
);

drop policy if exists "support attach select ticket owner" on storage.objects;
create policy "support attach select ticket owner"
on storage.objects for select to authenticated
using (
  bucket_id = 'support-attachments'
  AND exists (
    select 1 from public.support_tickets t
    where t.id::text = (storage.foldername(name))[2]
      and t.user_id = auth.uid()
  )
);

drop policy if exists "support attach delete own" on storage.objects;
create policy "support attach delete own"
on storage.objects for delete to authenticated
using (
  bucket_id = 'support-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- 3) Updated RPCs with optional attachment_url
CREATE OR REPLACE FUNCTION public.create_support_ticket(
  _subject text,
  _body text,
  _priority support_ticket_priority DEFAULT 'normal'::support_ticket_priority,
  _attachment_url text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  new_id uuid;
  uemail text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_bans WHERE user_id = uid) THEN
    RAISE EXCEPTION 'banned';
  END IF;
  IF length(trim(coalesce(_subject,''))) < 2 THEN RAISE EXCEPTION 'subject required'; END IF;
  IF length(trim(coalesce(_body,''))) < 1 AND coalesce(_attachment_url,'') = '' THEN
    RAISE EXCEPTION 'message required';
  END IF;

  SELECT email::text INTO uemail FROM auth.users WHERE id = uid;

  INSERT INTO public.support_tickets (user_id, subject, priority)
  VALUES (uid, left(_subject, 200), COALESCE(_priority,'normal'))
  RETURNING id INTO new_id;

  INSERT INTO public.support_messages (ticket_id, sender_id, sender_type, sender_email, body, attachment_url)
  VALUES (new_id, uid, 'user', uemail, coalesce(_body,''), nullif(_attachment_url,''));

  RETURN new_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.post_support_message(
  _ticket_id uuid,
  _body text,
  _attachment_url text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  is_admin boolean;
  t public.support_tickets%ROWTYPE;
  s public.support_sender_type;
  uemail text;
  new_msg uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF length(trim(coalesce(_body,''))) < 1 AND coalesce(_attachment_url,'') = '' THEN
    RAISE EXCEPTION 'empty message';
  END IF;

  SELECT * INTO t FROM public.support_tickets WHERE id = _ticket_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket not found'; END IF;

  is_admin := public.has_role(uid, 'admin');
  IF is_admin THEN
    s := 'admin';
  ELSE
    IF t.user_id <> uid THEN RAISE EXCEPTION 'forbidden'; END IF;
    IF t.status = 'closed' THEN RAISE EXCEPTION 'ticket closed'; END IF;
    IF EXISTS (SELECT 1 FROM public.user_bans WHERE user_id = uid) THEN RAISE EXCEPTION 'banned'; END IF;
    s := 'user';
  END IF;

  SELECT email::text INTO uemail FROM auth.users WHERE id = uid;

  INSERT INTO public.support_messages (ticket_id, sender_id, sender_type, sender_email, body, attachment_url)
  VALUES (_ticket_id, uid, s, uemail, coalesce(_body,''), nullif(_attachment_url,''))
  RETURNING id INTO new_msg;

  RETURN new_msg;
END;
$function$;
