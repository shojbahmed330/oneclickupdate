
-- 1) Tighten orders INSERT policy (defense in depth — trigger also overwrites these)
DROP POLICY IF EXISTS "Users create own orders" ON public.orders;
CREATE POLICY "Users create own orders"
ON public.orders
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND status = 'pending'::order_status
  AND COALESCE(risk_score, 0) = 0
  AND COALESCE(needs_review, false) = false
  AND refunded_at IS NULL
  AND COALESCE(refunded_credits, 0) = 0
  AND approved_at IS NULL
  AND admin_notes IS NULL OR admin_notes = ''
  AND NOT EXISTS (SELECT 1 FROM public.user_bans WHERE user_id = auth.uid())
);

-- 2) Promo abuse: also count user's pending+approved orders with this promo
CREATE OR REPLACE FUNCTION public.validate_promo(_code text, _package_id uuid, _amount numeric)
RETURNS TABLE(promo_id uuid, discount_amount numeric, bonus_credits integer, final_amount numeric, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  p public.promo_codes%ROWTYPE;
  uid uuid := auth.uid();
  user_uses INTEGER;
  pending_uses INTEGER;
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

  -- Approved redemptions
  SELECT COUNT(*) INTO user_uses
  FROM public.promo_redemptions
  WHERE promo_id = p.id AND user_id = uid;

  -- Plus pending orders with same promo (prevents spam-pending-orders abuse)
  SELECT COUNT(*) INTO pending_uses
  FROM public.orders
  WHERE user_id = uid
    AND status = 'pending'::order_status
    AND upper(COALESCE(promo_code, '')) = upper(p.code);

  IF (user_uses + pending_uses) >= p.per_user_limit THEN
    RETURN QUERY SELECT NULL::uuid, 0::numeric, 0, _amount,
      'You have already used this code (or have a pending order using it)'::text; RETURN;
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
$function$;

-- 3) Stricter fraud detection rules
CREATE OR REPLACE FUNCTION public.detect_order_fraud()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  dup_count int;
  account_count int;
  ip_count int;
  velocity_count int;
  burst_count int;
  is_banned boolean;
  score int := 0;
BEGIN
  -- Force-reset client-supplied fraud fields (defense in depth)
  NEW.risk_score := 0;
  NEW.needs_review := false;

  -- Banned user → auto-reject
  SELECT EXISTS(SELECT 1 FROM public.user_bans WHERE user_id = NEW.user_id) INTO is_banned;
  IF is_banned THEN
    NEW.status := 'rejected'::order_status;
    NEW.admin_notes := COALESCE(NEW.admin_notes, '') || ' [auto] banned user';
    NEW.risk_score := 100;
    NEW.needs_review := true;
    RETURN NEW;
  END IF;

  -- Duplicate transaction_id → critical, auto-flag (always)
  IF NEW.transaction_id IS NOT NULL AND NEW.transaction_id <> '' THEN
    SELECT count(*) INTO dup_count
    FROM public.orders
    WHERE transaction_id = NEW.transaction_id;
    IF dup_count > 0 THEN
      score := score + 100;
    END IF;
  END IF;

  -- Same sender account ≥ 2 in 24h (was 3) → flag
  IF NEW.sender_account IS NOT NULL AND NEW.sender_account <> '' THEN
    SELECT count(*) INTO account_count
    FROM public.orders
    WHERE sender_account = NEW.sender_account
      AND created_at > now() - interval '24 hours';
    IF account_count >= 2 THEN
      score := score + 40;
    END IF;
  END IF;

  -- Same IP from ≥ 2 distinct users in 24h (was 3) → flag
  IF NEW.ip_address IS NOT NULL AND NEW.ip_address <> '' THEN
    SELECT count(DISTINCT user_id) INTO ip_count
    FROM public.orders
    WHERE ip_address = NEW.ip_address
      AND created_at > now() - interval '24 hours';
    IF ip_count >= 2 THEN
      score := score + 50;
    END IF;
  END IF;

  -- Velocity: ≥ 3 orders in 1h (was 5) → flag
  SELECT count(*) INTO velocity_count
  FROM public.orders
  WHERE user_id = NEW.user_id
    AND created_at > now() - interval '1 hour';
  IF velocity_count >= 3 THEN
    score := score + 35;
  END IF;

  -- Burst: same user + same amount within 5 min → flag
  SELECT count(*) INTO burst_count
  FROM public.orders
  WHERE user_id = NEW.user_id
    AND amount = NEW.amount
    AND created_at > now() - interval '5 minutes';
  IF burst_count >= 1 THEN
    score := score + 30;
  END IF;

  NEW.risk_score := score;
  IF score >= 50 THEN
    NEW.needs_review := true;
  END IF;

  RETURN NEW;
END;
$function$;
