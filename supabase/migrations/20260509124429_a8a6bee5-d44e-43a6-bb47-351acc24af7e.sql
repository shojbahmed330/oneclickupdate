
CREATE OR REPLACE FUNCTION public.credit_cost_for(
  _input_tokens int,
  _output_tokens int,
  _tool_iterations int,
  _model text
) RETURNS int
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  in_rate numeric;
  out_rate numeric;
  m text := lower(coalesce(_model, ''));
  cost numeric;
BEGIN
  -- Tier rates: credits per 1k tokens
  IF m LIKE '%sonnet%' OR m LIKE '%opus%' THEN
    in_rate := 3; out_rate := 15;
  ELSIF m LIKE '%haiku%' OR m LIKE '%flash%' THEN
    in_rate := 0.25; out_rate := 1.25;
  ELSIF m LIKE '%gpt-5%' OR m LIKE '%gemini%pro%' OR m LIKE '%gemini-2.5-pro%' THEN
    in_rate := 1.25; out_rate := 5;
  ELSE
    -- default mid-tier
    in_rate := 1; out_rate := 4;
  END IF;

  cost := (coalesce(_input_tokens,0)::numeric / 1000.0) * in_rate
        + (coalesce(_output_tokens,0)::numeric / 1000.0) * out_rate
        + coalesce(_tool_iterations,0)::numeric * 0.5;

  RETURN GREATEST(1, ceil(cost)::int);
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_run_credits(
  _input_tokens int,
  _output_tokens int,
  _tool_iterations int,
  _model text,
  _reason text DEFAULT 'AI usage'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  cost int;
  current_balance int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  cost := public.credit_cost_for(_input_tokens, _output_tokens, _tool_iterations, _model);

  SELECT balance INTO current_balance
  FROM public.user_credits WHERE user_id = uid FOR UPDATE;

  IF current_balance IS NULL THEN
    INSERT INTO public.user_credits (user_id, balance, total_purchased)
    VALUES (uid, 0, 0)
    ON CONFLICT (user_id) DO NOTHING;
    current_balance := 0;
  END IF;

  -- Allow going to 0; do not error here (run is already done).
  -- Cap at current balance to avoid negative.
  IF current_balance < cost THEN
    cost := current_balance;
  END IF;

  IF cost > 0 THEN
    UPDATE public.user_credits
    SET balance = balance - cost, updated_at = now()
    WHERE user_id = uid;

    PERFORM public.log_credit_tx(uid, -cost, 'ai_usage'::public.credit_source, _reason, NULL, uid);
  END IF;

  RETURN jsonb_build_object(
    'cost', cost,
    'balance_after', current_balance - cost,
    'input_tokens', _input_tokens,
    'output_tokens', _output_tokens,
    'tool_iterations', _tool_iterations,
    'model', _model
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.credit_cost_for(int,int,int,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consume_run_credits(int,int,int,text,text) TO authenticated, service_role;
