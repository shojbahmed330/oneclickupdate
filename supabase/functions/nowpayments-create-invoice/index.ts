// Creates a NowPayments hosted invoice for a credit package purchase.
// Converts BDT → USDT using app_settings.usdt_to_bdt_rate (default 126).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const NOWPAYMENTS_API = "https://api.nowpayments.io/v1";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const NP_KEY = Deno.env.get("NOWPAYMENTS_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    if (!NP_KEY) throw new Error("NOWPAYMENTS_API_KEY not configured");

    // Verify caller
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const { package_id, promo_code, return_url } = body as {
      package_id?: string; promo_code?: string; return_url?: string;
    };
    if (!package_id) return json({ error: "package_id required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Fetch package
    const { data: pkg, error: pkgErr } = await admin
      .from("packages").select("*").eq("id", package_id).eq("is_active", true).maybeSingle();
    if (pkgErr || !pkg) return json({ error: "Package not found" }, 404);

    // Fetch settings (rate)
    const { data: settings } = await admin
      .from("app_settings").select("usdt_to_bdt_rate").eq("id", true).maybeSingle();
    const rate = Number(settings?.usdt_to_bdt_rate ?? 126);

    // Apply promo if provided (server-side validation via existing RPC)
    let finalBdt = Number(pkg.price);
    let promoDiscount = 0;
    let promoBonus = 0;
    let appliedCode: string | null = null;
    if (promo_code) {
      const { data: promo } = await admin
        .from("promo_codes").select("*").eq("code", promo_code.trim().toUpperCase())
        .eq("is_active", true).maybeSingle();
      if (promo) {
        const now = Date.now();
        const valid =
          (!promo.starts_at || new Date(promo.starts_at).getTime() <= now) &&
          (!promo.expires_at || new Date(promo.expires_at).getTime() > now) &&
          finalBdt >= Number(promo.min_amount ?? 0);
        if (valid) {
          if (promo.discount_type === "percent") {
            promoDiscount = Math.min(
              (finalBdt * Number(promo.discount_value)) / 100,
              promo.max_discount ? Number(promo.max_discount) : Infinity,
            );
          } else {
            promoDiscount = Number(promo.discount_value);
          }
          promoDiscount = Math.round(promoDiscount * 100) / 100;
          finalBdt = Math.max(0, finalBdt - promoDiscount);
          promoBonus = Number(promo.bonus_credits ?? 0);
          appliedCode = promo.code;
        }
      }
    }

    if (finalBdt <= 0) return json({ error: "Invalid amount" }, 400);

    // Convert to USDT (≈ USD)
    const priceUsdt = Math.max(0.5, Math.round((finalBdt / rate) * 100) / 100);

    // Create order row first (status pending)
    const { data: order, error: ordErr } = await admin
      .from("orders").insert({
        user_id: user.id,
        package_id: pkg.id,
        package_name: pkg.name,
        amount: finalBdt,
        credits: pkg.credits,
        payment_method: "crypto",
        sender_account: "",
        transaction_id: "",
        crypto_currency: "auto",
        status: "pending",
        promo_code: appliedCode,
        promo_discount: promoDiscount,
        promo_bonus_credits: promoBonus,
      }).select("id").single();
    if (ordErr || !order) {
      console.error("order insert failed", ordErr);
      return json({ error: "Failed to create order" }, 500);
    }

    // Build NowPayments invoice
    const ipnCallback = `${SUPABASE_URL}/functions/v1/nowpayments-webhook`;
    const successUrl = return_url || "https://smartapp24.lovable.app/shop?np=success";
    const cancelUrl = return_url || "https://smartapp24.lovable.app/shop?np=cancel";

    const npRes = await fetch(`${NOWPAYMENTS_API}/invoice`, {
      method: "POST",
      headers: {
        "x-api-key": NP_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        price_amount: priceUsdt,
        price_currency: "usdt",
        order_id: order.id,
        order_description: `${pkg.name} — ${pkg.credits} credits`,
        ipn_callback_url: ipnCallback,
        success_url: successUrl,
        cancel_url: cancelUrl,
      }),
    });
    const npData = await npRes.json();
    if (!npRes.ok) {
      console.error("NowPayments invoice failed", npData);
      // mark order as rejected
      await admin.from("orders").update({
        status: "rejected",
        admin_notes: `NowPayments error: ${JSON.stringify(npData).slice(0, 200)}`,
      }).eq("id", order.id);
      return json({ error: "Payment provider error", details: npData }, 502);
    }

    // Save invoice info
    await admin.from("orders").update({
      nowpayments_invoice_id: String(npData.id ?? ""),
      payment_url: npData.invoice_url,
    }).eq("id", order.id);

    return json({
      ok: true,
      order_id: order.id,
      invoice_url: npData.invoice_url,
      price_usdt: priceUsdt,
      price_bdt: finalBdt,
      rate,
    });
  } catch (e) {
    console.error("create-invoice error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
