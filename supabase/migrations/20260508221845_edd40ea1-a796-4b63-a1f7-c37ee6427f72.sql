SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

-- ============================================================
-- TYPES (12)
-- ============================================================

CREATE TYPE public.activity_severity AS ENUM ('info', 'warn', 'critical');
CREATE TYPE public.app_role AS ENUM ('admin', 'user');
CREATE TYPE public.build_platform AS ENUM ('android', 'ios');
CREATE TYPE public.build_status AS ENUM ('queued','preparing','building','uploading','ready','failed','cancelled');
CREATE TYPE public.credit_source AS ENUM ('purchase','admin_gift','admin_deduct','refund','ai_usage','promo_bonus','signup_bonus');
CREATE TYPE public.fraud_flag_type AS ENUM ('duplicate_txid','repeat_account','repeat_ip','velocity','banned_user','mismatched_account','high_risk_score');
CREATE TYPE public.order_status AS ENUM ('pending','approved','rejected','refunded');
CREATE TYPE public.payment_method_type AS ENUM ('bkash','nagad','rocket','crypto');
CREATE TYPE public.promo_discount_type AS ENUM ('percent','flat');
CREATE TYPE public.support_sender_type AS ENUM ('user','admin','system');
CREATE TYPE public.support_ticket_priority AS ENUM ('low','normal','high','urgent');
CREATE TYPE public.support_ticket_status AS ENUM ('open','pending','resolved','closed');

-- ============================================================
-- FUNCTIONS (66)
-- ============================================================

CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE FUNCTION public.has_feature_flag(_user_id uuid, _flag_key text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.feature_flags
    WHERE user_id = _user_id
      AND flag_key = _flag_key
      AND enabled = true
  );
$$;

CREATE FUNCTION public.log_activity(_action text, _target_type text DEFAULT NULL::text, _target_id text DEFAULT NULL::text, _summary text DEFAULT ''::text, _old jsonb DEFAULT NULL::jsonb, _new jsonb DEFAULT NULL::jsonb, _severity public.activity_severity DEFAULT 'info'::public.activity_severity, _metadata jsonb DEFAULT NULL::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  new_id uuid;
  uid uuid := auth.uid();
  uemail text;
  is_admin_actor boolean := false;
BEGIN
  IF uid IS NOT NULL THEN
    SELECT email::text INTO uemail FROM auth.users WHERE id = uid;
    is_admin_actor := public.has_role(uid, 'admin');
  END IF;

  INSERT INTO public.activity_logs (
    actor_id, actor_email, actor_role, action, target_type, target_id,
    summary, old_values, new_values, severity, metadata
  ) VALUES (
    uid, uemail,
    CASE WHEN is_admin_actor THEN 'admin' ELSE 'user' END,
    _action, _target_type, _target_id,
    COALESCE(_summary, ''), _old, _new, COALESCE(_severity, 'info'), _metadata
  ) RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

CREATE FUNCTION public.log_credit_tx(_user_id uuid, _delta integer, _source public.credit_source, _reason text DEFAULT ''::text, _reference_id uuid DEFAULT NULL::uuid, _created_by uuid DEFAULT NULL::uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  new_balance INTEGER;
BEGIN
  SELECT balance INTO new_balance FROM public.user_credits WHERE user_id = _user_id;
  INSERT INTO public.credit_transactions (user_id, delta, balance_after, source, reason, reference_id, created_by)
  VALUES (_user_id, _delta, COALESCE(new_balance, 0), _source, COALESCE(_reason, ''), _reference_id, _created_by);
END;
$$;

CREATE FUNCTION public.send_notification(_user_id uuid, _title text, _body text DEFAULT ''::text, _type text DEFAULT 'info'::text, _link text DEFAULT ''::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE nid uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  INSERT INTO public.notifications (user_id, title, body, type, link)
  VALUES (_user_id, _title, COALESCE(_body, ''), COALESCE(_type, 'info'), COALESCE(_link, ''))
  RETURNING id INTO nid;
  RETURN nid;
END;
$$;

CREATE FUNCTION public.tg_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE FUNCTION public.touch_app_builds_updated_at() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE FUNCTION public.assign_default_role() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  user_count int;
BEGIN
  SELECT count(*) INTO user_count FROM public.user_roles;
  IF user_count = 0 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'display_name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.cleanup_ai_cache() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE n int;
BEGIN
  DELETE FROM public.ai_response_cache WHERE expires_at < now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE FUNCTION public.consume_credits(_amount integer, _reason text DEFAULT 'AI usage'::text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  current_balance int;
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION 'amount must be positive'; END IF;

  SELECT balance INTO current_balance FROM public.user_credits WHERE user_id = uid FOR UPDATE;
  IF current_balance IS NULL OR current_balance < _amount THEN
    RAISE EXCEPTION 'insufficient credits';
  END IF;

  UPDATE public.user_credits
  SET balance = balance - _amount, updated_at = now()
  WHERE user_id = uid;

  PERFORM public.log_credit_tx(uid, -_amount, 'ai_usage'::public.credit_source, _reason, NULL, uid);
  RETURN current_balance - _amount;
END;
$$;

CREATE FUNCTION public.mark_all_notifications_read() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE n int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  UPDATE public.notifications SET read = true WHERE user_id = auth.uid() AND read = false;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

CREATE FUNCTION public.mark_ticket_read(_ticket_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  uid uuid := auth.uid();
  is_admin boolean;
  t public.support_tickets%ROWTYPE;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT * INTO t FROM public.support_tickets WHERE id = _ticket_id;
  IF NOT FOUND THEN RETURN; END IF;
  is_admin := public.has_role(uid, 'admin');
  IF is_admin THEN
    UPDATE public.support_tickets SET admin_unread_count = 0 WHERE id = _ticket_id;
  ELSIF t.user_id = uid THEN
    UPDATE public.support_tickets SET user_unread_count = 0 WHERE id = _ticket_id;
  END IF;
END;
$$;

CREATE FUNCTION public.create_support_ticket(_subject text, _body text, _priority public.support_ticket_priority DEFAULT 'normal'::public.support_ticket_priority) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
  IF length(trim(coalesce(_body,''))) < 1 THEN RAISE EXCEPTION 'message required'; END IF;

  SELECT email::text INTO uemail FROM auth.users WHERE id = uid;

  INSERT INTO public.support_tickets (user_id, subject, priority)
  VALUES (uid, left(_subject, 200), COALESCE(_priority,'normal'))
  RETURNING id INTO new_id;

  INSERT INTO public.support_messages (ticket_id, sender_id, sender_type, sender_email, body)
  VALUES (new_id, uid, 'user', uemail, _body);

  RETURN new_id;
END;
$$;

CREATE FUNCTION public.post_support_message(_ticket_id uuid, _body text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  uid uuid := auth.uid();
  is_admin boolean;
  t public.support_tickets%ROWTYPE;
  s public.support_sender_type;
  uemail text;
  new_msg uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF length(trim(coalesce(_body,''))) < 1 THEN RAISE EXCEPTION 'empty message'; END IF;

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

  INSERT INTO public.support_messages (ticket_id, sender_id, sender_type, sender_email, body)
  VALUES (_ticket_id, uid, s, uemail, _body)
  RETURNING id INTO new_msg;

  RETURN new_msg;
END;
$$;

CREATE FUNCTION public.set_ticket_status(_ticket_id uuid, _status public.support_ticket_status) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  uid uuid := auth.uid();
  is_admin boolean;
  t public.support_tickets%ROWTYPE;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT * INTO t FROM public.support_tickets WHERE id = _ticket_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found'; END IF;
  is_admin := public.has_role(uid, 'admin');
  IF NOT is_admin AND t.user_id <> uid THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT is_admin AND _status NOT IN ('resolved','closed') THEN RAISE EXCEPTION 'forbidden'; END IF;

  UPDATE public.support_tickets
  SET status = _status,
      closed_at = CASE WHEN _status IN ('closed','resolved') THEN now() ELSE NULL END,
      updated_at = now()
  WHERE id = _ticket_id;
END;
$$;

CREATE FUNCTION public.get_agent_version_preference() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  uid uuid := auth.uid();
  pref boolean;
BEGIN
  IF uid IS NULL THEN RETURN false; END IF;
  IF NOT public.has_role(uid, 'admin') THEN RETURN false; END IF;

  SELECT enabled INTO pref
  FROM public.feature_flags
  WHERE user_id = uid AND flag_key = 'prefer_agent_v2';

  RETURN COALESCE(pref, false);
END;
$$;

CREATE FUNCTION public.set_agent_version_preference(_use_v2 boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  IF NOT public.has_role(uid, 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  INSERT INTO public.feature_flags (user_id, flag_key, enabled, metadata)
  VALUES (uid, 'prefer_agent_v2', _use_v2, '{}'::jsonb)
  ON CONFLICT (user_id, flag_key)
  DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now();
END;
$$;

CREATE FUNCTION public.record_project_error(_project_id uuid, _file_path text, _error_message text, _error_stack text, _fix_summary text, _fix_kind text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _uid uuid := auth.uid();
  _new_id uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = _project_id AND user_id = _uid) THEN
    RAISE EXCEPTION 'project not owned';
  END IF;

  INSERT INTO public.project_error_history(
    project_id, user_id, file_path, error_message, error_stack, fix_summary, fix_kind
  ) VALUES (
    _project_id, _uid,
    COALESCE(_file_path, ''),
    LEFT(COALESCE(_error_message, ''), 1000),
    LEFT(COALESCE(_error_stack, ''), 2000),
    LEFT(COALESCE(_fix_summary, ''), 500),
    COALESCE(_fix_kind, 'auto-heal')
  )
  RETURNING id INTO _new_id;

  DELETE FROM public.project_error_history
  WHERE project_id = _project_id
    AND id NOT IN (
      SELECT id FROM public.project_error_history
      WHERE project_id = _project_id
      ORDER BY created_at DESC
      LIMIT 10
    );

  RETURN _new_id;
END;
$$;

CREATE FUNCTION public.validate_promo(_code text, _package_id uuid, _amount numeric) RETURNS TABLE(promo_id uuid, discount_amount numeric, bonus_credits integer, final_amount numeric, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  p public.promo_codes%ROWTYPE;
  uid uuid := auth.uid();
  user_uses INTEGER;
  disc NUMERIC := 0;
BEGIN
  IF uid IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, 0::numeric, 0, _amount, 'Login required'::text; RETURN;
  END IF;

  SELECT * INTO p FROM public.promo_codes WHERE upper(code) = upper(_code);
  IF NOT FOUND OR NOT p.is_active THEN
    RETURN QUERY SELECT NULL::uuid, 0::numeric, 0, _amount, 'Invalid code'::text; RETURN;
  END IF;

  IF p.starts_at > now() THEN
    RETURN QUERY SELECT NULL::uuid, 0::numeric, 0, _amount, 'Code not yet active'::text; RETURN;
  END IF;
  IF p.expires_at IS NOT NULL AND p.expires_at < now() THEN
    RETURN QUERY SELECT NULL::uuid, 0::numeric, 0, _amount, 'Code expired'::text; RETURN;
  END IF;
  IF p.usage_limit IS NOT NULL AND p.used_count >= p.usage_limit THEN
    RETURN QUERY SELECT NULL::uuid, 0::numeric, 0, _amount, 'Code usage limit reached'::text; RETURN;
  END IF;
  IF _amount < p.min_amount THEN
    RETURN QUERY SELECT NULL::uuid, 0::numeric, 0, _amount, 'Minimum amount ৳' || p.min_amount || ' required'; RETURN;
  END IF;
  IF array_length(p.applicable_package_ids, 1) > 0 AND NOT (_package_id = ANY(p.applicable_package_ids)) THEN
    RETURN QUERY SELECT NULL::uuid, 0::numeric, 0, _amount, 'Code not applicable for this package'::text; RETURN;
  END IF;

  SELECT COUNT(*) INTO user_uses FROM public.promo_redemptions WHERE promo_id = p.id AND user_id = uid;
  IF user_uses >= p.per_user_limit THEN
    RETURN QUERY SELECT NULL::uuid, 0::numeric, 0, _amount, 'You have already used this code'::text; RETURN;
  END IF;

  IF p.discount_type = 'percent' THEN
    disc := round(_amount * (p.discount_value / 100.0), 2);
  ELSE
    disc := p.discount_value;
  END IF;

  IF p.max_discount IS NOT NULL AND disc > p.max_discount THEN
    disc := p.max_discount;
  END IF;
  IF disc > _amount THEN disc := _amount; END IF;

  RETURN QUERY SELECT p.id, disc, p.bonus_credits, GREATEST(_amount - disc, 0), 'Applied'::text;
END;
$$;

CREATE FUNCTION public.redeem_promo_for_order(_order_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  o public.orders%ROWTYPE;
  p public.promo_codes%ROWTYPE;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = _order_id;
  IF NOT FOUND OR o.promo_code IS NULL OR o.promo_code = '' THEN RETURN; END IF;

  SELECT * INTO p FROM public.promo_codes WHERE upper(code) = upper(o.promo_code);
  IF NOT FOUND THEN RETURN; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.promo_redemptions WHERE order_id = _order_id) THEN
    INSERT INTO public.promo_redemptions (promo_id, user_id, order_id, discount_amount, bonus_credits)
    VALUES (p.id, o.user_id, o.id, o.promo_discount, o.promo_bonus_credits);

    UPDATE public.promo_codes SET used_count = used_count + 1 WHERE id = p.id;

    IF o.promo_bonus_credits > 0 THEN
      UPDATE public.user_credits
      SET balance = balance + o.promo_bonus_credits,
          total_purchased = total_purchased + o.promo_bonus_credits,
          updated_at = now()
      WHERE user_id = o.user_id;
      PERFORM public.log_credit_tx(o.user_id, o.promo_bonus_credits, 'promo_bonus'::public.credit_source,
        'Promo ' || p.code || ' bonus', o.id, NULL);
    END IF;
  END IF;
END;
$$;

CREATE FUNCTION public.log_auth_event(_action text, _email text DEFAULT NULL::text, _success boolean DEFAULT true, _metadata jsonb DEFAULT NULL::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  new_id uuid;
  sev public.activity_severity := 'info';
BEGIN
  IF NOT _success THEN sev := 'warn'; END IF;

  INSERT INTO public.activity_logs (
    actor_id, actor_email, actor_role, action, target_type, target_id,
    summary, severity, metadata
  ) VALUES (
    auth.uid(), COALESCE(_email, (SELECT email::text FROM auth.users WHERE id = auth.uid())),
    'user', 'auth.' || _action, 'auth', _email,
    CASE WHEN _success THEN 'Auth: ' || _action ELSE 'Failed: ' || _action || ' (' || COALESCE(_email,'unknown') || ')' END,
    sev, _metadata
  ) RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

CREATE FUNCTION public.auto_reject_stale_orders() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  s public.app_settings%ROWTYPE;
  n int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO s FROM public.app_settings WHERE id = true;
  IF COALESCE(s.order_auto_reject_days, 0) <= 0 THEN
    RETURN 0;
  END IF;
  UPDATE public.orders
  SET status = 'rejected',
      admin_notes = COALESCE(NULLIF(admin_notes,''), 'Auto-rejected: not approved within ' || s.order_auto_reject_days || ' days'),
      updated_at = now()
  WHERE status = 'pending'
    AND created_at < now() - (s.order_auto_reject_days || ' days')::interval;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

CREATE FUNCTION public.auto_reject_stale_orders_cron() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  s public.app_settings%ROWTYPE;
  n int;
BEGIN
  SELECT * INTO s FROM public.app_settings WHERE id = true;
  IF COALESCE(s.order_auto_reject_days, 0) <= 0 THEN
    RETURN 0;
  END IF;
  UPDATE public.orders
  SET status = 'rejected',
      admin_notes = COALESCE(NULLIF(admin_notes,''), 'Auto-rejected: not approved within ' || s.order_auto_reject_days || ' days'),
      updated_at = now()
  WHERE status = 'pending'
    AND created_at < now() - (s.order_auto_reject_days || ' days')::interval;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

CREATE FUNCTION public.admin_adjust_credits(_user_id uuid, _delta integer, _reason text DEFAULT ''::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  current_balance int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _delta = 0 THEN
    RAISE EXCEPTION 'delta must be non-zero';
  END IF;

  INSERT INTO public.user_credits (user_id, balance, total_purchased)
  VALUES (_user_id, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT balance INTO current_balance FROM public.user_credits WHERE user_id = _user_id;

  IF current_balance + _delta < 0 THEN
    RAISE EXCEPTION 'insufficient balance: % cannot deduct %', current_balance, _delta;
  END IF;

  UPDATE public.user_credits
  SET balance = balance + _delta,
      total_purchased = total_purchased + GREATEST(_delta, 0),
      updated_at = now()
  WHERE user_id = _user_id;

  PERFORM public.log_credit_tx(
    _user_id,
    _delta,
    CASE WHEN _delta > 0 THEN 'admin_gift'::public.credit_source ELSE 'admin_deduct'::public.credit_source END,
    COALESCE(NULLIF(_reason, ''), 'Manual adjustment by admin'),
    NULL,
    auth.uid()
  );
END;
$$;

CREATE FUNCTION public.admin_ban_user(_user_id uuid, _reason text DEFAULT ''::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _admin uuid := auth.uid();
  _email text;
BEGIN
  IF NOT has_role(_admin, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'user_id required';
  END IF;

  INSERT INTO public.user_bans (user_id, banned_by, reason)
  VALUES (_user_id, _admin, COALESCE(_reason, ''))
  ON CONFLICT (user_id) DO UPDATE
    SET banned_by = EXCLUDED.banned_by,
        reason    = EXCLUDED.reason,
        banned_at = now();

  SELECT email INTO _email FROM auth.users WHERE id = _admin;

  INSERT INTO public.activity_logs (
    actor_id, actor_email, actor_role,
    action, target_type, target_id,
    summary, severity, metadata
  ) VALUES (
    _admin, _email, 'admin',
    'user.ban', 'user', _user_id::text,
    'Admin banned user' ||
      CASE WHEN _reason <> '' THEN ' — ' || _reason ELSE '' END,
    'critical',
    jsonb_build_object('reason', _reason)
  );
END;
$$;

CREATE FUNCTION public.admin_unban_user(_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _admin uuid := auth.uid();
  _email text;
BEGIN
  IF NOT has_role(_admin, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  DELETE FROM public.user_bans WHERE user_id = _user_id;

  SELECT email INTO _email FROM auth.users WHERE id = _admin;

  INSERT INTO public.activity_logs (
    actor_id, actor_email, actor_role,
    action, target_type, target_id,
    summary, severity
  ) VALUES (
    _admin, _email, 'admin',
    'user.unban', 'user', _user_id::text,
    'Admin removed ban from user',
    'warn'
  );
END;
$$;

CREATE FUNCTION public.admin_set_ban(_user_id uuid, _ban boolean, _reason text DEFAULT ''::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF _user_id = auth.uid() AND _ban THEN
    RAISE EXCEPTION 'cannot ban yourself';
  END IF;

  IF _ban THEN
    INSERT INTO public.user_bans (user_id, reason, banned_by)
    VALUES (_user_id, COALESCE(_reason, ''), auth.uid())
    ON CONFLICT (user_id) DO UPDATE SET reason = EXCLUDED.reason, banned_by = auth.uid(), banned_at = now();
  ELSE
    DELETE FROM public.user_bans WHERE user_id = _user_id;
  END IF;
END;
$$;

CREATE FUNCTION public.admin_set_role(_user_id uuid, _make_admin boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF _user_id = auth.uid() AND NOT _make_admin THEN
    RAISE EXCEPTION 'cannot demote yourself';
  END IF;

  IF _make_admin THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    DELETE FROM public.user_roles WHERE user_id = _user_id AND role = 'admin';
    INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, 'user')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
END;
$$;

CREATE FUNCTION public.admin_bulk_adjust_prices(_package_ids uuid[], _percent numeric DEFAULT NULL::numeric, _flat_delta numeric DEFAULT NULL::numeric, _round_to numeric DEFAULT 1) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  n int;
  ids uuid[];
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _round_to IS NULL OR _round_to <= 0 THEN _round_to := 1; END IF;

  IF _package_ids IS NULL OR array_length(_package_ids, 1) IS NULL THEN
    SELECT array_agg(id) INTO ids FROM public.packages;
  ELSE
    ids := _package_ids;
  END IF;

  UPDATE public.packages
  SET price = GREATEST(
        round(((price + COALESCE(_flat_delta, 0)) * (1 + COALESCE(_percent, 0)/100.0)) / _round_to) * _round_to,
        0
      ),
      updated_at = now()
  WHERE id = ANY(ids);

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

CREATE FUNCTION public.admin_bulk_approve_orders(_order_ids uuid[]) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE n int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.orders
  SET status = 'approved', updated_at = now()
  WHERE id = ANY(_order_ids) AND status = 'pending';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

CREATE FUNCTION public.admin_bulk_reject_orders(_order_ids uuid[], _reason text DEFAULT ''::text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE n int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.orders
  SET status = 'rejected',
      admin_notes = COALESCE(NULLIF(_reason, ''), admin_notes),
      updated_at = now()
  WHERE id = ANY(_order_ids) AND status = 'pending';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

CREATE FUNCTION public.admin_bulk_set_package_active(_package_ids uuid[], _active boolean) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE n int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.packages SET is_active = _active, updated_at = now()
  WHERE id = ANY(_package_ids);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

CREATE FUNCTION public.admin_create_manual_order(_user_id uuid, _package_id uuid, _credits integer, _amount numeric DEFAULT 0, _package_name text DEFAULT 'Manual order'::text, _payment_method public.payment_method_type DEFAULT 'bkash'::public.payment_method_type, _notes text DEFAULT ''::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE new_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _credits <= 0 THEN RAISE EXCEPTION 'credits must be positive'; END IF;

  INSERT INTO public.orders (
    user_id, package_id, package_name, credits, amount,
    payment_method, status, admin_notes, transaction_id
  ) VALUES (
    _user_id,
    COALESCE(_package_id, gen_random_uuid()),
    COALESCE(NULLIF(_package_name,''), 'Manual order'),
    _credits,
    COALESCE(_amount, 0),
    _payment_method,
    'approved',
    COALESCE(_notes, 'Created by admin'),
    'MANUAL-' || to_char(now(),'YYYYMMDDHH24MISS')
  )
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

CREATE FUNCTION public.admin_refund_order(_order_id uuid, _reason text DEFAULT ''::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  o public.orders%ROWTYPE;
  curr_balance int;
  to_deduct int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT * INTO o FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order not found'; END IF;
  IF o.status <> 'approved' THEN RAISE EXCEPTION 'only approved orders can be refunded'; END IF;

  SELECT balance INTO curr_balance FROM public.user_credits WHERE user_id = o.user_id FOR UPDATE;
  curr_balance := COALESCE(curr_balance, 0);

  to_deduct := LEAST(o.credits + COALESCE(o.promo_bonus_credits, 0), curr_balance);

  IF to_deduct > 0 THEN
    UPDATE public.user_credits
    SET balance = balance - to_deduct, updated_at = now()
    WHERE user_id = o.user_id;
  END IF;

  UPDATE public.orders
  SET status = 'refunded',
      refunded_at = now(),
      refund_reason = COALESCE(_reason, ''),
      refunded_credits = to_deduct,
      updated_at = now()
  WHERE id = _order_id;

  PERFORM public.log_credit_tx(
    o.user_id,
    -to_deduct,
    'refund'::public.credit_source,
    'Refund order ' || _order_id::text || CASE WHEN _reason <> '' THEN ' — ' || _reason ELSE '' END,
    _order_id,
    auth.uid()
  );
END;
$$;

CREATE FUNCTION public.admin_resolve_flag(_flag_id uuid, _note text DEFAULT ''::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  oid uuid;
  remaining int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;

  UPDATE public.order_flags
  SET resolved = true, resolved_at = now(), resolved_by = auth.uid(),
      resolution_note = COALESCE(_note, '')
  WHERE id = _flag_id
  RETURNING order_id INTO oid;

  IF oid IS NULL THEN RAISE EXCEPTION 'flag not found'; END IF;

  SELECT count(*) INTO remaining FROM public.order_flags
  WHERE order_id = oid AND resolved = false;

  IF remaining = 0 THEN
    UPDATE public.orders SET needs_review = false WHERE id = oid;
  END IF;

  PERFORM public.log_activity(
    'flag.resolved', 'order', oid::text,
    'Resolved fraud flag' || CASE WHEN _note <> '' THEN ' — ' || _note ELSE '' END,
    NULL, jsonb_build_object('flag_id', _flag_id, 'note', _note),
    'info', NULL
  );
END;
$$;

CREATE FUNCTION public.admin_resolve_order_flags(_order_id uuid, _note text DEFAULT ''::text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE n int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;

  UPDATE public.order_flags
  SET resolved = true, resolved_at = now(), resolved_by = auth.uid(),
      resolution_note = COALESCE(_note, '')
  WHERE order_id = _order_id AND resolved = false;
  GET DIAGNOSTICS n = ROW_COUNT;

  UPDATE public.orders SET needs_review = false WHERE id = _order_id;

  PERFORM public.log_activity(
    'flag.bulk_resolved', 'order', _order_id::text,
    'Resolved all flags (' || n || ')' || CASE WHEN _note <> '' THEN ' — ' || _note ELSE '' END,
    NULL, jsonb_build_object('count', n, 'note', _note),
    'info', NULL
  );
  RETURN n;
END;
$$;

CREATE FUNCTION public.admin_fraud_stats() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT jsonb_build_object(
    'pending_review', (SELECT count(*) FROM public.orders WHERE needs_review = true),
    'total_flags_open', (SELECT count(*) FROM public.order_flags WHERE resolved = false),
    'total_flags_resolved', (SELECT count(*) FROM public.order_flags WHERE resolved = true),
    'flags_24h', (SELECT count(*) FROM public.order_flags WHERE created_at > now() - interval '24 hours'),
    'by_type', COALESCE((
      SELECT jsonb_object_agg(flag_type, c) FROM (
        SELECT flag_type, count(*) AS c FROM public.order_flags
        WHERE resolved = false GROUP BY flag_type
      ) t
    ), '{}'::jsonb)
  ) INTO result;
  RETURN result;
END;
$$;

CREATE FUNCTION public.admin_support_stats() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE r jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT jsonb_build_object(
    'open', (SELECT count(*) FROM public.support_tickets WHERE status='open'),
    'pending', (SELECT count(*) FROM public.support_tickets WHERE status='pending'),
    'resolved', (SELECT count(*) FROM public.support_tickets WHERE status='resolved'),
    'closed', (SELECT count(*) FROM public.support_tickets WHERE status='closed'),
    'unread_admin', (SELECT COALESCE(SUM(admin_unread_count),0) FROM public.support_tickets),
    'awaiting_reply', (SELECT count(*) FROM public.support_tickets WHERE status='open' AND last_sender='user')
  ) INTO r;
  RETURN r;
END;
$$;

CREATE FUNCTION public.admin_get_activity_alerts() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  result jsonb;
  alerts jsonb := '[]'::jsonb;
  rec record;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;

  FOR rec IN
    SELECT actor_email, count(*) AS c
    FROM public.activity_logs
    WHERE action = 'order.refunded' AND created_at > now() - interval '24 hours'
    GROUP BY actor_email HAVING count(*) >= 3
  LOOP
    alerts := alerts || jsonb_build_object(
      'type', 'mass_refunds', 'severity', 'warn',
      'message', rec.actor_email || ' issued ' || rec.c || ' refunds in 24h',
      'count', rec.c
    );
  END LOOP;

  FOR rec IN
    SELECT actor_email, count(*) AS c
    FROM public.activity_logs
    WHERE action = 'package.updated' AND created_at > now() - interval '1 hour'
    GROUP BY actor_email HAVING count(*) >= 5
  LOOP
    alerts := alerts || jsonb_build_object(
      'type', 'bulk_price_change', 'severity', 'warn',
      'message', rec.actor_email || ' modified ' || rec.c || ' packages in 1h',
      'count', rec.c
    );
  END LOOP;

  FOR rec IN
    SELECT count(*) AS c
    FROM public.activity_logs
    WHERE severity = 'critical' AND created_at > now() - interval '7 days'
  LOOP
    IF rec.c > 0 THEN
      alerts := alerts || jsonb_build_object(
        'type', 'critical_events', 'severity', 'critical',
        'message', rec.c || ' critical event(s) in last 7 days (role changes)',
        'count', rec.c
      );
    END IF;
  END LOOP;

  FOR rec IN
    SELECT actor_email, count(*) AS c
    FROM public.activity_logs
    WHERE actor_role = 'admin'
      AND created_at > now() - interval '7 days'
      AND extract(hour from created_at AT TIME ZONE 'Asia/Dhaka') BETWEEN 1 AND 5
    GROUP BY actor_email HAVING count(*) >= 5
  LOOP
    alerts := alerts || jsonb_build_object(
      'type', 'off_hours', 'severity', 'info',
      'message', rec.actor_email || ' had ' || rec.c || ' actions during 1–5am',
      'count', rec.c
    );
  END LOOP;

  FOR rec IN
    SELECT count(*) AS c
    FROM public.activity_logs
    WHERE action = 'credits.admin_deduct'
      AND created_at > now() - interval '24 hours'
      AND (new_values->>'delta')::int <= -1000
  LOOP
    IF rec.c > 0 THEN
      alerts := alerts || jsonb_build_object(
        'type', 'large_deduction', 'severity', 'warn',
        'message', rec.c || ' large credit deduction(s) (≥1000) in 24h',
        'count', rec.c
      );
    END IF;
  END LOOP;

  result := jsonb_build_object(
    'alerts', alerts,
    'totals', jsonb_build_object(
      'last_24h', (SELECT count(*) FROM public.activity_logs WHERE created_at > now() - interval '24 hours'),
      'last_7d', (SELECT count(*) FROM public.activity_logs WHERE created_at > now() - interval '7 days'),
      'critical_7d', (SELECT count(*) FROM public.activity_logs WHERE severity = 'critical' AND created_at > now() - interval '7 days'),
      'warn_7d', (SELECT count(*) FROM public.activity_logs WHERE severity = 'warn' AND created_at > now() - interval '7 days')
    )
  );
  RETURN result;
END;
$$;

CREATE FUNCTION public.admin_get_analytics() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  result jsonb;
  rev_today numeric;
  rev_week numeric;
  rev_month numeric;
  rev_all numeric;
  orders_pending int;
  orders_approved int;
  orders_rejected int;
  total_users int;
  paying_users int;
  banned_users int;
  admin_users int;
  avg_order numeric;
  daily_trend jsonb;
  top_pkgs jsonb;
  by_method jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO rev_today
  FROM public.orders
  WHERE status = 'approved' AND created_at >= date_trunc('day', now());

  SELECT COALESCE(SUM(amount), 0) INTO rev_week
  FROM public.orders
  WHERE status = 'approved' AND created_at >= now() - interval '7 days';

  SELECT COALESCE(SUM(amount), 0) INTO rev_month
  FROM public.orders
  WHERE status = 'approved' AND created_at >= now() - interval '30 days';

  SELECT COALESCE(SUM(amount), 0) INTO rev_all
  FROM public.orders
  WHERE status = 'approved';

  SELECT COUNT(*) INTO orders_pending FROM public.orders WHERE status = 'pending';
  SELECT COUNT(*) INTO orders_approved FROM public.orders WHERE status = 'approved';
  SELECT COUNT(*) INTO orders_rejected FROM public.orders WHERE status = 'rejected';

  SELECT COALESCE(AVG(amount), 0) INTO avg_order
  FROM public.orders
  WHERE status = 'approved' AND amount > 0;

  SELECT COUNT(*) INTO total_users FROM auth.users;
  SELECT COUNT(DISTINCT user_id) INTO paying_users
  FROM public.orders
  WHERE status = 'approved' AND amount > 0;
  SELECT COUNT(*) INTO banned_users FROM public.user_bans;
  SELECT COUNT(DISTINCT user_id) INTO admin_users FROM public.user_roles WHERE role = 'admin';

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.day), '[]'::jsonb) INTO daily_trend
  FROM (
    SELECT
      to_char(d::date, 'YYYY-MM-DD') AS day,
      COALESCE(SUM(o.amount), 0)::numeric AS revenue,
      COUNT(o.id)::int AS orders
    FROM generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') d
    LEFT JOIN public.orders o
      ON date_trunc('day', o.created_at) = d AND o.status = 'approved'
    GROUP BY d
    ORDER BY d
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.revenue DESC), '[]'::jsonb) INTO top_pkgs
  FROM (
    SELECT
      package_name AS name,
      COUNT(*)::int AS orders,
      COALESCE(SUM(amount), 0)::numeric AS revenue,
      COALESCE(SUM(credits), 0)::int AS credits_sold
    FROM public.orders
    WHERE status = 'approved'
    GROUP BY package_name
    ORDER BY revenue DESC
    LIMIT 5
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.revenue DESC), '[]'::jsonb) INTO by_method
  FROM (
    SELECT
      payment_method::text AS method,
      COUNT(*)::int AS orders,
      COALESCE(SUM(amount), 0)::numeric AS revenue
    FROM public.orders
    WHERE status = 'approved'
    GROUP BY payment_method
  ) t;

  result := jsonb_build_object(
    'revenue', jsonb_build_object(
      'today', rev_today,
      'week', rev_week,
      'month', rev_month,
      'all_time', rev_all
    ),
    'orders', jsonb_build_object(
      'pending', orders_pending,
      'approved', orders_approved,
      'rejected', orders_rejected,
      'avg_order_value', round(avg_order, 2)
    ),
    'users', jsonb_build_object(
      'total', total_users,
      'paying', paying_users,
      'banned', banned_users,
      'admins', admin_users,
      'conversion_rate', CASE WHEN total_users > 0 THEN round((paying_users::numeric / total_users::numeric) * 100, 2) ELSE 0 END
    ),
    'daily_trend', daily_trend,
    'top_packages', top_pkgs,
    'by_payment_method', by_method
  );

  RETURN result;
END;
$$;

CREATE FUNCTION public.admin_list_activity(_action text DEFAULT NULL::text, _severity public.activity_severity DEFAULT NULL::public.activity_severity, _actor_id uuid DEFAULT NULL::uuid, _target_type text DEFAULT NULL::text, _target_id text DEFAULT NULL::text, _from timestamp with time zone DEFAULT NULL::timestamp with time zone, _to timestamp with time zone DEFAULT NULL::timestamp with time zone, _search text DEFAULT NULL::text, _limit integer DEFAULT 200) RETURNS TABLE(id uuid, actor_id uuid, actor_email text, actor_role text, action text, target_type text, target_id text, summary text, old_values jsonb, new_values jsonb, severity public.activity_severity, ip_address text, user_agent text, metadata jsonb, created_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;

  RETURN QUERY
  SELECT a.id, a.actor_id, a.actor_email, a.actor_role, a.action, a.target_type,
         a.target_id, a.summary, a.old_values, a.new_values, a.severity,
         a.ip_address, a.user_agent, a.metadata, a.created_at
  FROM public.activity_logs a
  WHERE (_action IS NULL OR a.action = _action)
    AND (_severity IS NULL OR a.severity = _severity)
    AND (_actor_id IS NULL OR a.actor_id = _actor_id)
    AND (_target_type IS NULL OR a.target_type = _target_type)
    AND (_target_id IS NULL OR a.target_id = _target_id)
    AND (_from IS NULL OR a.created_at >= _from)
    AND (_to IS NULL OR a.created_at <= _to)
    AND (_search IS NULL OR a.summary ILIKE '%' || _search || '%' OR a.actor_email ILIKE '%' || _search || '%')
  ORDER BY a.created_at DESC
  LIMIT COALESCE(_limit, 200);
END;
$$;

CREATE FUNCTION public.admin_list_credit_transactions(_user_id uuid DEFAULT NULL::uuid, _source public.credit_source DEFAULT NULL::public.credit_source, _from timestamp with time zone DEFAULT NULL::timestamp with time zone, _to timestamp with time zone DEFAULT NULL::timestamp with time zone, _limit integer DEFAULT 500) RETURNS TABLE(id uuid, user_id uuid, email text, display_name text, delta integer, balance_after integer, source public.credit_source, reason text, reference_id uuid, created_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
  SELECT t.id, t.user_id, u.email::text, p.display_name, t.delta, t.balance_after,
         t.source, t.reason, t.reference_id, t.created_at
  FROM public.credit_transactions t
  LEFT JOIN auth.users u ON u.id = t.user_id
  LEFT JOIN public.profiles p ON p.user_id = t.user_id
  WHERE (_user_id IS NULL OR t.user_id = _user_id)
    AND (_source IS NULL OR t.source = _source)
    AND (_from IS NULL OR t.created_at >= _from)
    AND (_to IS NULL OR t.created_at <= _to)
  ORDER BY t.created_at DESC
  LIMIT COALESCE(_limit, 500);
END;
$$;

CREATE FUNCTION public.admin_list_flagged_orders(_resolved boolean DEFAULT false, _limit integer DEFAULT 200) RETURNS TABLE(order_id uuid, user_id uuid, user_email text, display_name text, package_name text, amount numeric, status public.order_status, payment_method public.payment_method_type, sender_account text, transaction_id text, ip_address text, risk_score integer, needs_review boolean, created_at timestamp with time zone, flag_count bigint, flag_types text[], max_severity public.activity_severity, flags jsonb)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;

  RETURN QUERY
  SELECT
    o.id, o.user_id, u.email::text, p.display_name,
    o.package_name, o.amount, o.status, o.payment_method,
    o.sender_account, o.transaction_id, o.ip_address,
    o.risk_score, o.needs_review, o.created_at,
    count(f.id) AS flag_count,
    array_agg(f.flag_type::text ORDER BY f.created_at) AS flag_types,
    max(f.severity)::activity_severity AS max_severity,
    jsonb_agg(jsonb_build_object(
      'id', f.id,
      'type', f.flag_type,
      'severity', f.severity,
      'reason', f.reason,
      'details', f.details,
      'resolved', f.resolved,
      'resolved_at', f.resolved_at,
      'resolution_note', f.resolution_note,
      'created_at', f.created_at
    ) ORDER BY f.created_at) AS flags
  FROM public.orders o
  JOIN public.order_flags f ON f.order_id = o.id
  LEFT JOIN auth.users u ON u.id = o.user_id
  LEFT JOIN public.profiles p ON p.user_id = o.user_id
  WHERE (CASE WHEN _resolved THEN true
              ELSE EXISTS(SELECT 1 FROM public.order_flags f2 WHERE f2.order_id = o.id AND f2.resolved = false)
         END)
  GROUP BY o.id, u.email, p.display_name
  ORDER BY o.created_at DESC
  LIMIT COALESCE(_limit, 200);
END;
$$;

CREATE FUNCTION public.admin_list_tickets(_status public.support_ticket_status DEFAULT NULL::public.support_ticket_status, _limit integer DEFAULT 200) RETURNS TABLE(id uuid, user_id uuid, user_email text, display_name text, subject text, status public.support_ticket_status, priority public.support_ticket_priority, last_message_at timestamp with time zone, last_message_preview text, last_sender public.support_sender_type, admin_unread_count integer, user_unread_count integer, message_count integer, created_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
  SELECT t.id, t.user_id, u.email::text, p.display_name,
         t.subject, t.status, t.priority,
         t.last_message_at, t.last_message_preview, t.last_sender,
         t.admin_unread_count, t.user_unread_count, t.message_count,
         t.created_at
  FROM public.support_tickets t
  LEFT JOIN auth.users u ON u.id = t.user_id
  LEFT JOIN public.profiles p ON p.user_id = t.user_id
  WHERE (_status IS NULL OR t.status = _status)
  ORDER BY t.last_message_at DESC
  LIMIT COALESCE(_limit, 200);
END;
$$;

CREATE FUNCTION public.admin_list_users() RETURNS TABLE(user_id uuid, email text, display_name text, avatar_url text, created_at timestamp with time zone, is_admin boolean, is_banned boolean, ban_reason text, credit_balance integer, total_purchased integer, total_spent numeric, order_count integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    u.id AS user_id,
    u.email::text AS email,
    p.display_name,
    p.avatar_url,
    u.created_at,
    EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role = 'admin') AS is_admin,
    EXISTS (SELECT 1 FROM public.user_bans b WHERE b.user_id = u.id) AS is_banned,
    COALESCE((SELECT b.reason FROM public.user_bans b WHERE b.user_id = u.id), '') AS ban_reason,
    COALESCE(c.balance, 0) AS credit_balance,
    COALESCE(c.total_purchased, 0) AS total_purchased,
    COALESCE((SELECT SUM(o.amount) FROM public.orders o WHERE o.user_id = u.id AND o.status = 'approved'), 0) AS total_spent,
    COALESCE((SELECT COUNT(*)::int FROM public.orders o WHERE o.user_id = u.id), 0) AS order_count
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.user_id = u.id
  LEFT JOIN public.user_credits c ON c.user_id = u.id
  ORDER BY u.created_at DESC;
END;
$$;

CREATE FUNCTION public.create_invoice_on_approval() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  s public.app_settings%ROWTYPE;
  inv_no text;
  sub numeric;
  vat_amt numeric;
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') AND NEW.amount > 0 THEN
    SELECT * INTO s FROM public.app_settings WHERE id = true;
    IF COALESCE(s.vat_percent, 0) > 0 THEN
      sub := round(NEW.amount / (1 + s.vat_percent/100.0), 2);
      vat_amt := round(NEW.amount - sub, 2);
    ELSE
      sub := NEW.amount;
      vat_amt := 0;
    END IF;
    inv_no := COALESCE(NULLIF(s.invoice_prefix,''),'INV') || '-' || to_char(now(),'YYYYMMDD') || '-' || substr(replace(NEW.id::text,'-',''), 1, 6);

    INSERT INTO public.invoices (order_id, user_id, invoice_number, subtotal, vat_percent, vat_amount, total)
    VALUES (NEW.id, NEW.user_id, inv_no, sub, COALESCE(s.vat_percent, 0), vat_amt, NEW.amount)
    ON CONFLICT (order_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.credit_on_approval() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    NEW.approved_at := now();
    INSERT INTO public.user_credits (user_id, balance, total_purchased)
    VALUES (NEW.user_id, NEW.credits, NEW.credits)
    ON CONFLICT (user_id) DO UPDATE
      SET balance = public.user_credits.balance + NEW.credits,
          total_purchased = public.user_credits.total_purchased + NEW.credits,
          updated_at = now();
    PERFORM public.log_credit_tx(
      NEW.user_id,
      NEW.credits,
      CASE WHEN NEW.package_name LIKE 'Admin %' THEN 'admin_gift'::public.credit_source ELSE 'purchase'::public.credit_source END,
      'Order ' || NEW.id::text,
      NEW.id,
      auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.detect_order_fraud() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  dup_count int;
  account_count int;
  ip_count int;
  velocity_count int;
  is_banned boolean;
  score int := 0;
  flags_added int := 0;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.user_bans WHERE user_id = NEW.user_id) INTO is_banned;
  IF is_banned THEN
    score := score + 100;
    NEW.needs_review := true;
  END IF;

  IF NEW.transaction_id IS NOT NULL AND NEW.transaction_id <> '' THEN
    SELECT count(*) INTO dup_count
    FROM public.orders
    WHERE transaction_id = NEW.transaction_id;
    IF dup_count > 0 THEN
      score := score + 80;
      NEW.needs_review := true;
    END IF;
  END IF;

  IF NEW.sender_account IS NOT NULL AND NEW.sender_account <> '' THEN
    SELECT count(*) INTO account_count
    FROM public.orders
    WHERE sender_account = NEW.sender_account
      AND created_at > now() - interval '24 hours';
    IF account_count >= 3 THEN
      score := score + 30;
      NEW.needs_review := true;
    END IF;
  END IF;

  IF NEW.ip_address IS NOT NULL AND NEW.ip_address <> '' THEN
    SELECT count(DISTINCT user_id) INTO ip_count
    FROM public.orders
    WHERE ip_address = NEW.ip_address
      AND created_at > now() - interval '24 hours';
    IF ip_count >= 3 THEN
      score := score + 40;
      NEW.needs_review := true;
    END IF;
  END IF;

  SELECT count(*) INTO velocity_count
  FROM public.orders
  WHERE user_id = NEW.user_id
    AND created_at > now() - interval '1 hour';
  IF velocity_count >= 5 THEN
    score := score + 25;
    NEW.needs_review := true;
  END IF;

  NEW.risk_score := score;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.create_order_flags() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  dup_count int;
  account_count int;
  ip_count int;
  velocity_count int;
  is_banned boolean;
  prev_order_id uuid;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.user_bans WHERE user_id = NEW.user_id) INTO is_banned;
  IF is_banned THEN
    INSERT INTO public.order_flags (order_id, user_id, flag_type, severity, reason)
    VALUES (NEW.id, NEW.user_id, 'banned_user', 'critical',
      'Banned user attempted to place order');
  END IF;

  IF NEW.transaction_id IS NOT NULL AND NEW.transaction_id <> '' THEN
    SELECT count(*) INTO dup_count FROM public.orders
    WHERE transaction_id = NEW.transaction_id AND id <> NEW.id;
    IF dup_count > 0 THEN
      SELECT id INTO prev_order_id FROM public.orders
      WHERE transaction_id = NEW.transaction_id AND id <> NEW.id
      ORDER BY created_at DESC LIMIT 1;
      INSERT INTO public.order_flags (order_id, user_id, flag_type, severity, reason, details)
      VALUES (NEW.id, NEW.user_id, 'duplicate_txid', 'critical',
        'Transaction ID "' || NEW.transaction_id || '" already used in ' || dup_count || ' other order(s)',
        jsonb_build_object('previous_order_id', prev_order_id, 'duplicate_count', dup_count));
    END IF;
  END IF;

  IF NEW.sender_account IS NOT NULL AND NEW.sender_account <> '' THEN
    SELECT count(*) INTO account_count FROM public.orders
    WHERE sender_account = NEW.sender_account
      AND created_at > now() - interval '24 hours' AND id <> NEW.id;
    IF account_count >= 2 THEN
      INSERT INTO public.order_flags (order_id, user_id, flag_type, severity, reason, details)
      VALUES (NEW.id, NEW.user_id, 'repeat_account', 'warn',
        'Sender account ' || NEW.sender_account || ' used in ' || (account_count + 1) || ' orders in 24h',
        jsonb_build_object('sender_account', NEW.sender_account, 'count_24h', account_count + 1));
    END IF;
  END IF;

  IF NEW.ip_address IS NOT NULL AND NEW.ip_address <> '' THEN
    SELECT count(DISTINCT user_id) INTO ip_count FROM public.orders
    WHERE ip_address = NEW.ip_address
      AND created_at > now() - interval '24 hours';
    IF ip_count >= 3 THEN
      INSERT INTO public.order_flags (order_id, user_id, flag_type, severity, reason, details)
      VALUES (NEW.id, NEW.user_id, 'repeat_ip', 'warn',
        'IP ' || NEW.ip_address || ' used by ' || ip_count || ' different users in 24h',
        jsonb_build_object('ip', NEW.ip_address, 'distinct_users_24h', ip_count));
    END IF;
  END IF;

  SELECT count(*) INTO velocity_count FROM public.orders
  WHERE user_id = NEW.user_id
    AND created_at > now() - interval '1 hour' AND id <> NEW.id;
  IF velocity_count >= 4 THEN
    INSERT INTO public.order_flags (order_id, user_id, flag_type, severity, reason, details)
    VALUES (NEW.id, NEW.user_id, 'velocity', 'warn',
      'User submitted ' || (velocity_count + 1) || ' orders in 1 hour',
      jsonb_build_object('count_1h', velocity_count + 1));
  END IF;

  IF NEW.risk_score >= 80 THEN
    INSERT INTO public.order_flags (order_id, user_id, flag_type, severity, reason, details)
    VALUES (NEW.id, NEW.user_id, 'high_risk_score', 'critical',
      'High risk score: ' || NEW.risk_score,
      jsonb_build_object('risk_score', NEW.risk_score));
  END IF;

  IF NEW.needs_review THEN
    PERFORM public.log_activity(
      'order.flagged', 'order', NEW.id::text,
      'Order flagged for review (risk ' || NEW.risk_score || ') — ' || NEW.package_name || ' ৳' || NEW.amount,
      NULL,
      jsonb_build_object('risk_score', NEW.risk_score, 'amount', NEW.amount, 'user_id', NEW.user_id),
      CASE WHEN NEW.risk_score >= 80 THEN 'critical'::activity_severity ELSE 'warn'::activity_severity END,
      jsonb_build_object('ip', NEW.ip_address, 'transaction_id', NEW.transaction_id)
    );

    INSERT INTO public.notifications (user_id, title, body, type, link)
    SELECT r.user_id,
      '🚨 Order flagged for review',
      'Order ' || NEW.package_name || ' (৳' || NEW.amount || ') flagged. Risk score: ' || NEW.risk_score,
      'warning',
      '/admin/activity'
    FROM public.user_roles r WHERE r.role = 'admin';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.notify_admins_on_new_order() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE r record;
BEGIN
  IF NEW.status = 'pending' THEN
    FOR r IN SELECT user_id FROM public.user_roles WHERE role = 'admin' LOOP
      PERFORM public.send_notification(
        r.user_id,
        'New pending order',
        'Order for ' || NEW.package_name || ' (৳' || NEW.amount || ') awaiting review.',
        'order',
        '/admin/shop'
      );
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.notify_low_balance() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.balance < 50 AND (OLD.balance IS NULL OR OLD.balance >= 50) THEN
    PERFORM public.send_notification(
      NEW.user_id,
      'Low credit balance',
      'You have only ' || NEW.balance || ' credits left. Top up to keep building.',
      'warning',
      '/shop'
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.notify_user_on_order_status() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'approved' THEN
      PERFORM public.send_notification(
        NEW.user_id,
        'Order approved 🎉',
        'Your order for ' || NEW.package_name || ' has been approved. ' || NEW.credits || ' credits added.',
        'success',
        '/shop'
      );
    ELSIF NEW.status = 'rejected' THEN
      PERFORM public.send_notification(
        NEW.user_id,
        'Order rejected',
        'Your order for ' || NEW.package_name || ' was rejected.' ||
          CASE WHEN COALESCE(NEW.admin_notes,'') <> '' THEN ' Reason: ' || NEW.admin_notes ELSE '' END,
        'error',
        '/shop'
      );
    ELSIF NEW.status = 'refunded' THEN
      PERFORM public.send_notification(
        NEW.user_id,
        'Order refunded',
        'Your order for ' || NEW.package_name || ' has been refunded.' ||
          CASE WHEN COALESCE(NEW.refund_reason,'') <> '' THEN ' Reason: ' || NEW.refund_reason ELSE '' END,
        'warning',
        '/shop'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.log_credit_transaction() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  sev public.activity_severity := 'info';
  act text;
BEGIN
  IF NEW.source IN ('admin_gift', 'admin_deduct', 'refund') THEN
    act := 'credits.' || NEW.source::text;
    IF abs(NEW.delta) >= 1000 THEN sev := 'warn'; END IF;

    PERFORM public.log_activity(
      act, 'user', NEW.user_id::text,
      CASE WHEN NEW.delta > 0 THEN 'Granted ' ELSE 'Deducted ' END
        || abs(NEW.delta) || ' credits — ' || COALESCE(NEW.reason, ''),
      NULL,
      jsonb_build_object('delta', NEW.delta, 'balance_after', NEW.balance_after, 'reason', NEW.reason, 'source', NEW.source),
      sev, NULL
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.log_order_status_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  sev public.activity_severity := 'info';
  act text;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    act := 'order.' || NEW.status::text;
    IF NEW.status = 'refunded' THEN sev := 'warn';
    ELSIF NEW.status = 'rejected' THEN sev := 'warn';
    END IF;

    PERFORM public.log_activity(
      act, 'order', NEW.id::text,
      'Order ' || NEW.package_name || ' (৳' || NEW.amount || ') → ' || NEW.status::text,
      jsonb_build_object('status', OLD.status, 'admin_notes', OLD.admin_notes, 'refund_reason', OLD.refund_reason),
      jsonb_build_object('status', NEW.status, 'admin_notes', NEW.admin_notes, 'refund_reason', NEW.refund_reason, 'amount', NEW.amount, 'credits', NEW.credits, 'user_id', NEW.user_id),
      sev, NULL
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.log_announcement_changes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_activity('announcement.created', 'announcement', NEW.id::text,
      'Created announcement: ' || NEW.title, NULL, to_jsonb(NEW), 'info', NULL);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.log_activity('announcement.deleted', 'announcement', OLD.id::text,
      'Deleted announcement: ' || OLD.title, to_jsonb(OLD), NULL, 'warn', NULL);
    RETURN OLD;
  ELSE
    PERFORM public.log_activity('announcement.updated', 'announcement', NEW.id::text,
      'Updated announcement: ' || NEW.title,
      jsonb_build_object('title', OLD.title, 'is_active', OLD.is_active, 'expires_at', OLD.expires_at),
      jsonb_build_object('title', NEW.title, 'is_active', NEW.is_active, 'expires_at', NEW.expires_at),
      'info', NULL);
    RETURN NEW;
  END IF;
END;
$$;

CREATE FUNCTION public.log_faq_changes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_activity('faq.created', 'faq', NEW.id::text,
      'Created FAQ: ' || NEW.question, NULL, to_jsonb(NEW), 'info', NULL);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.log_activity('faq.deleted', 'faq', OLD.id::text,
      'Deleted FAQ: ' || OLD.question, to_jsonb(OLD), NULL, 'warn', NULL);
    RETURN OLD;
  ELSE
    PERFORM public.log_activity('faq.updated', 'faq', NEW.id::text,
      'Updated FAQ: ' || NEW.question, NULL, NULL, 'info', NULL);
    RETURN NEW;
  END IF;
END;
$$;

CREATE FUNCTION public.log_package_changes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  changes jsonb := '{}'::jsonb;
  old_vals jsonb := '{}'::jsonb;
  new_vals jsonb := '{}'::jsonb;
  s text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_activity(
      'package.created', 'package', NEW.id::text,
      'Created package: ' || NEW.name || ' (৳' || NEW.price || ' / ' || NEW.credits || ' cr)',
      NULL,
      to_jsonb(NEW),
      'info', NULL
    );
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.log_activity(
      'package.deleted', 'package', OLD.id::text,
      'Deleted package: ' || OLD.name,
      to_jsonb(OLD), NULL, 'warn', NULL
    );
    RETURN OLD;
  ELSE
    IF NEW.price IS DISTINCT FROM OLD.price THEN
      old_vals := old_vals || jsonb_build_object('price', OLD.price);
      new_vals := new_vals || jsonb_build_object('price', NEW.price);
    END IF;
    IF NEW.credits IS DISTINCT FROM OLD.credits THEN
      old_vals := old_vals || jsonb_build_object('credits', OLD.credits);
      new_vals := new_vals || jsonb_build_object('credits', NEW.credits);
    END IF;
    IF NEW.name IS DISTINCT FROM OLD.name THEN
      old_vals := old_vals || jsonb_build_object('name', OLD.name);
      new_vals := new_vals || jsonb_build_object('name', NEW.name);
    END IF;
    IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      old_vals := old_vals || jsonb_build_object('is_active', OLD.is_active);
      new_vals := new_vals || jsonb_build_object('is_active', NEW.is_active);
    END IF;
    IF NEW.is_popular IS DISTINCT FROM OLD.is_popular THEN
      old_vals := old_vals || jsonb_build_object('is_popular', OLD.is_popular);
      new_vals := new_vals || jsonb_build_object('is_popular', NEW.is_popular);
    END IF;

    IF old_vals <> '{}'::jsonb THEN
      s := 'Updated package: ' || NEW.name;
      PERFORM public.log_activity(
        'package.updated', 'package', NEW.id::text, s,
        old_vals, new_vals, 'info', NULL
      );
    END IF;
    RETURN NEW;
  END IF;
END;
$$;

CREATE FUNCTION public.log_promo_changes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_activity(
      'promo.created', 'promo', NEW.id::text,
      'Created promo: ' || NEW.code,
      NULL, to_jsonb(NEW), 'info', NULL
    );
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.log_activity(
      'promo.deleted', 'promo', OLD.id::text,
      'Deleted promo: ' || OLD.code,
      to_jsonb(OLD), NULL, 'warn', NULL
    );
    RETURN OLD;
  ELSE
    IF NEW.is_active IS DISTINCT FROM OLD.is_active
       OR NEW.discount_value IS DISTINCT FROM OLD.discount_value
       OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
      PERFORM public.log_activity(
        'promo.updated', 'promo', NEW.id::text,
        'Updated promo: ' || NEW.code,
        jsonb_build_object('is_active', OLD.is_active, 'discount_value', OLD.discount_value, 'expires_at', OLD.expires_at),
        jsonb_build_object('is_active', NEW.is_active, 'discount_value', NEW.discount_value, 'expires_at', NEW.expires_at),
        'info', NULL
      );
    END IF;
    RETURN NEW;
  END IF;
END;
$$;

CREATE FUNCTION public.log_role_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.role = 'admin' THEN
    PERFORM public.log_activity(
      'role.admin_granted', 'user', NEW.user_id::text,
      'Granted admin role',
      NULL, jsonb_build_object('role', NEW.role), 'critical', NULL
    );
  ELSIF TG_OP = 'DELETE' AND OLD.role = 'admin' THEN
    PERFORM public.log_activity(
      'role.admin_revoked', 'user', OLD.user_id::text,
      'Revoked admin role',
      jsonb_build_object('role', OLD.role), NULL, 'critical', NULL
    );
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE FUNCTION public.log_settings_update() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  old_vals jsonb := '{}'::jsonb;
  new_vals jsonb := '{}'::jsonb;
BEGIN
  IF NEW.maintenance_mode IS DISTINCT FROM OLD.maintenance_mode THEN
    old_vals := old_vals || jsonb_build_object('maintenance_mode', OLD.maintenance_mode);
    new_vals := new_vals || jsonb_build_object('maintenance_mode', NEW.maintenance_mode);
  END IF;
  IF NEW.vat_percent IS DISTINCT FROM OLD.vat_percent THEN
    old_vals := old_vals || jsonb_build_object('vat_percent', OLD.vat_percent);
    new_vals := new_vals || jsonb_build_object('vat_percent', NEW.vat_percent);
  END IF;
  IF NEW.site_name IS DISTINCT FROM OLD.site_name THEN
    old_vals := old_vals || jsonb_build_object('site_name', OLD.site_name);
    new_vals := new_vals || jsonb_build_object('site_name', NEW.site_name);
  END IF;
  IF NEW.contact_email IS DISTINCT FROM OLD.contact_email THEN
    old_vals := old_vals || jsonb_build_object('contact_email', OLD.contact_email);
    new_vals := new_vals || jsonb_build_object('contact_email', NEW.contact_email);
  END IF;
  IF NEW.invoice_prefix IS DISTINCT FROM OLD.invoice_prefix THEN
    old_vals := old_vals || jsonb_build_object('invoice_prefix', OLD.invoice_prefix);
    new_vals := new_vals || jsonb_build_object('invoice_prefix', NEW.invoice_prefix);
  END IF;
  IF NEW.order_auto_reject_days IS DISTINCT FROM OLD.order_auto_reject_days THEN
    old_vals := old_vals || jsonb_build_object('order_auto_reject_days', OLD.order_auto_reject_days);
    new_vals := new_vals || jsonb_build_object('order_auto_reject_days', NEW.order_auto_reject_days);
  END IF;

  IF old_vals <> '{}'::jsonb THEN
    PERFORM public.log_activity(
      'settings.updated', 'settings', 'app_settings',
      'App settings updated',
      old_vals, new_vals, 'warn', NULL
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.log_user_ban() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_activity(
      'user.banned', 'user', NEW.user_id::text,
      'User banned' || CASE WHEN NEW.reason <> '' THEN ' — ' || NEW.reason ELSE '' END,
      NULL, jsonb_build_object('reason', NEW.reason, 'banned_by', NEW.banned_by),
      'warn', NULL
    );
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.log_activity(
      'user.unbanned', 'user', OLD.user_id::text,
      'User unbanned',
      jsonb_build_object('reason', OLD.reason), NULL, 'info', NULL
    );
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE FUNCTION public.promo_on_approval() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved')
     AND NEW.promo_code IS NOT NULL AND NEW.promo_code <> '' THEN
    PERFORM public.redeem_promo_for_order(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.support_on_new_message() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  t public.support_tickets%ROWTYPE;
  preview text;
  admin_rec record;
BEGIN
  SELECT * INTO t FROM public.support_tickets WHERE id = NEW.ticket_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;

  preview := left(regexp_replace(NEW.body, E'[\\r\\n]+', ' ', 'g'), 140);

  IF NEW.sender_type = 'user' THEN
    UPDATE public.support_tickets
    SET last_message_at = NEW.created_at,
        last_message_preview = preview,
        last_sender = 'user',
        admin_unread_count = admin_unread_count + 1,
        message_count = message_count + 1,
        status = CASE WHEN status IN ('resolved','closed') THEN 'open' ELSE 'open' END,
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
        status = CASE WHEN status = 'closed' THEN 'closed' ELSE 'pending' END,
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
$$;

CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;