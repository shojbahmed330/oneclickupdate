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

  SELECT COUNT(*) INTO user_uses
  FROM public.promo_redemptions pr
  WHERE pr.promo_id = p.id AND pr.user_id = uid;

  SELECT COUNT(*) INTO pending_uses
  FROM public.orders o
  WHERE o.user_id = uid
    AND o.status = 'pending'::order_status
    AND upper(COALESCE(o.promo_code, '')) = upper(p.code);

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