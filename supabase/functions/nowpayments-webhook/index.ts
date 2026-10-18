// NowPayments IPN webhook — verifies HMAC-SHA512 signature using IPN secret,
// then updates the order status. Approval triggers auto-credit via DB trigger.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function hmacSha512Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Sort keys recursively then JSON.stringify (NowPayments spec)
function sortedStringify(obj: unknown): string {
  if (Array.isArray(obj)) {
    return "[" + obj.map(sortedStringify).join(",") + "]";
  }
  if (obj && typeof obj === "object") {
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    return "{" + keys.map((k) =>
      JSON.stringify(k) + ":" + sortedStringify((obj as Record<string, unknown>)[k])
    ).join(",") + "}";
  }
  return JSON.stringify(obj);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  try {
    const IPN_SECRET = Deno.env.get("NOWPAYMENTS_IPN_SECRET");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!IPN_SECRET) {
      console.error("NOWPAYMENTS_IPN_SECRET missing");
      return new Response("server misconfig", { status: 500 });
    }

    const rawBody = await req.text();
    const signature = req.headers.get("x-nowpayments-sig") ?? "";

    let payload: Record<string, unknown>;
    try { payload = JSON.parse(rawBody); }
    catch { return new Response("bad json", { status: 400 }); }

    const expected = await hmacSha512Hex(IPN_SECRET, sortedStringify(payload));
    if (expected !== signature) {
      console.warn("Signature mismatch", { expected: expected.slice(0, 12), got: signature.slice(0, 12) });
      return new Response("invalid signature", { status: 401 });
    }

    const orderId = String(payload.order_id ?? "");
    const paymentStatus = String(payload.payment_status ?? "");
    const paymentId = payload.payment_id ? String(payload.payment_id) : null;
    if (!orderId) return new Response("missing order_id", { status: 400 });

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Locate order — could be UUID match
    const { data: order } = await admin
      .from("orders")
      .select("id, status, transaction_id")
      .eq("id", orderId)
      .maybeSingle();
    if (!order) {
      console.warn("order not found", orderId);
      return new Response("ok", { status: 200 });
    }

    // Idempotency: skip if already approved
    if (order.status === "approved") {
      return new Response("ok", { status: 200 });
    }

    const update: Record<string, unknown> = {
      nowpayments_payment_id: paymentId,
      transaction_id: paymentId ?? order.transaction_id,
    };

    if (paymentStatus === "finished" || paymentStatus === "confirmed") {
      update.status = "approved";
      update.approved_at = new Date().toISOString();
    } else if (paymentStatus === "failed" || paymentStatus === "expired" || paymentStatus === "refunded") {
      update.status = "rejected";
      update.admin_notes = `NowPayments status: ${paymentStatus}`;
    }
    // partially_paid / waiting / sending → keep pending

    await admin.from("orders").update(update).eq("id", orderId);
    return new Response("ok", { status: 200 });
  } catch (e) {
    console.error("webhook error", e);
    return new Response("error", { status: 500 });
  }
});
