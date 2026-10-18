
ALTER TABLE public.payment_methods
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'manual';

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS nowpayments_invoice_id text,
  ADD COLUMN IF NOT EXISTS nowpayments_payment_id text,
  ADD COLUMN IF NOT EXISTS payment_url text;

CREATE INDEX IF NOT EXISTS idx_orders_nowpayments_invoice
  ON public.orders (nowpayments_invoice_id)
  WHERE nowpayments_invoice_id IS NOT NULL;

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS usdt_to_bdt_rate numeric NOT NULL DEFAULT 126;

INSERT INTO public.payment_methods (type, label, account_number, instructions, is_active, provider)
SELECT 'crypto', 'NowPayments (Auto Crypto)', 'auto', 'Pay with BTC, ETH, USDT, BNB and more — auto-confirmed in seconds.', true, 'nowpayments'
WHERE NOT EXISTS (
  SELECT 1 FROM public.payment_methods WHERE provider = 'nowpayments'
);
