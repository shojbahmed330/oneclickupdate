
-- Revoke EXECUTE from anon + authenticated for admin-only and internal SECURITY DEFINER functions.
-- These are still callable by service_role (edge functions / cron) which bypasses these grants.

-- Admin-only functions (all check has_role internally, but defense-in-depth)
REVOKE EXECUTE ON FUNCTION public.admin_adjust_credits(uuid, integer, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_ban_user(uuid, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_bulk_adjust_prices(uuid[], numeric, numeric, numeric) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_bulk_approve_orders(uuid[]) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_bulk_reject_orders(uuid[], text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_bulk_set_package_active(uuid[], boolean) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_create_manual_order(uuid, uuid, integer, numeric, text, payment_method_type, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_fraud_stats() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_get_activity_alerts() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_get_analytics() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_list_activity(text, activity_severity, uuid, text, text, timestamptz, timestamptz, text, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_list_credit_transactions(uuid, credit_source, timestamptz, timestamptz, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_list_flagged_orders(boolean, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_list_tickets(support_ticket_status, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_list_users() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_refund_order(uuid, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_resolve_flag(uuid, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_resolve_order_flags(uuid, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_set_ban(uuid, boolean, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_set_role(uuid, boolean) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_support_stats() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_unban_user(uuid) FROM anon, authenticated;

-- Cron / scheduled functions (should never be user-callable)
REVOKE EXECUTE ON FUNCTION public.auto_reject_stale_orders() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_reject_stale_orders_cron() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_ai_cache() FROM anon, authenticated;

-- Internal log writers (should only be invoked by edge functions / triggers via service_role)
REVOKE EXECUTE ON FUNCTION public.log_activity(text, text, text, text, jsonb, jsonb, activity_severity, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_auth_event(text, text, boolean, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_credit_tx(uuid, integer, credit_source, text, uuid, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.send_notification(uuid, text, text, text, text) FROM anon, authenticated;

-- NOTE: Intentionally KEEPING execute for these (user-facing or RLS helpers):
--   has_role, has_feature_flag                     -- used inside RLS policies
--   consume_credits, consume_run_credits           -- user actions
--   create_support_ticket, post_support_message,
--   mark_ticket_read, set_ticket_status,
--   mark_all_notifications_read                    -- user actions
--   redeem_promo_for_order, validate_promo         -- user actions
--   record_project_error                           -- client error reporting
