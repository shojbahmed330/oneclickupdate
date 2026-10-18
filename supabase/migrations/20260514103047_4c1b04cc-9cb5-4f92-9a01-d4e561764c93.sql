CREATE OR REPLACE FUNCTION public.support_on_new_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  t public.support_tickets%ROWTYPE;
  preview text;
  admin_rec record;
BEGIN
  SELECT * INTO t FROM public.support_tickets WHERE id = NEW.ticket_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;

  preview := left(regexp_replace(NEW.body, E'[\r\n]+', ' ', 'g'), 140);

  IF NEW.sender_type = 'user' THEN
    UPDATE public.support_tickets
    SET last_message_at = NEW.created_at,
        last_message_preview = preview,
        last_sender = 'user',
        admin_unread_count = admin_unread_count + 1,
        message_count = message_count + 1,
        status = (CASE WHEN status IN ('resolved','closed') THEN 'open' ELSE 'open' END)::public.support_ticket_status,
        updated_at = now()
    WHERE id = NEW.ticket_id;

    FOR admin_rec IN SELECT user_id FROM public.user_roles WHERE role = 'admin' LOOP
      PERFORM public.send_notification(
        admin_rec.user_id,
        'New support message',
        COALESCE(t.subject,'Ticket') || ': ' || preview,
        'info',
        '/admin/shop'
      );
    END LOOP;

  ELSIF NEW.sender_type = 'admin' THEN
    UPDATE public.support_tickets
    SET last_message_at = NEW.created_at,
        last_message_preview = preview,
        last_sender = 'admin',
        user_unread_count = user_unread_count + 1,
        message_count = message_count + 1,
        status = (CASE WHEN status = 'closed' THEN 'closed' ELSE 'pending' END)::public.support_ticket_status,
        updated_at = now()
    WHERE id = NEW.ticket_id;

    PERFORM public.send_notification(
      t.user_id,
      'Support replied',
      COALESCE(t.subject,'Ticket') || ': ' || preview,
      'info',
      '/profile?tab=support'
    );
  END IF;

  RETURN NEW;
END;
$function$;