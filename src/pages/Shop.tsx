import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { m } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCredits } from "@/hooks/useCredits";
import { useUserRole } from "@/hooks/useUserRole";
import { toast } from "sonner";
import { UserInvoices } from "@/components/UserInvoices";
import { AnnouncementsBar } from "@/components/AnnouncementsBar";
import { FaqSection } from "@/components/FaqSection";
import { OrderConfirmation, type ConfirmationData } from "@/components/shop/OrderConfirmation";
import { type AppliedPromo } from "@/components/shop/PromoInput";
import { ShopHeader } from "./shop/ShopHeader";
import { PackageGrid } from "./shop/PackageGrid";
import { OrderHistory } from "./shop/OrderHistory";
import { BuyDialog } from "./shop/BuyDialog";
import { CreditGuide } from "./shop/CreditGuide";
import type { Package, PaymentMethod, Order } from "./shop/types";
import { FAB } from "@/components/mobile/FAB";
import { ShoppingCart } from "lucide-react";

const Shop = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { balance, totalPurchased } = useCredits();
  const { isAdmin } = useUserRole();

  const qc = useQueryClient();

  const [selected, setSelected] = useState<Package | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null);
  const [senderAccount, setSenderAccount] = useState("");
  const [transactionId, setTransactionId] = useState("");
  const [cryptoCurrency, setCryptoCurrency] = useState("USDT");
  const [submitting, setSubmitting] = useState(false);
  const [promoApplied, setPromoApplied] = useState<AppliedPromo | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationData | null>(null);

  useEffect(() => {
    if (!authLoading && !user) navigate("/auth", { replace: true });
  }, [authLoading, user, navigate]);

  const { data: packages = [], isLoading: pkgLoading } = useQuery({
    queryKey: ["shop", "packages"],
    queryFn: async (): Promise<Package[]> => {
      const { data } = await supabase.from("packages").select("*").eq("is_active", true).order("sort_order");
      return (data ?? []) as Package[];
    },
    enabled: !!user,
    staleTime: 60_000,
  });
  const { data: methods = [], isLoading: pmLoading } = useQuery({
    queryKey: ["shop", "payment_methods"],
    queryFn: async (): Promise<PaymentMethod[]> => {
      const { data } = await supabase.from("payment_methods").select("*").eq("is_active", true).order("type");
      return (data ?? []) as PaymentMethod[];
    },
    enabled: !!user,
    staleTime: 60_000,
  });
  const { data: orders = [], isLoading: ordLoading } = useQuery({
    queryKey: ["shop", "orders", user?.id],
    queryFn: async (): Promise<Order[]> => {
      const { data } = await supabase
        .from("orders")
        .select("id, package_name, amount, credits, payment_method, status, created_at, admin_notes")
        .order("created_at", { ascending: false })
        .limit(20);
      return (data ?? []) as Order[];
    },
    enabled: !!user,
    staleTime: 30_000,
  });
  const loading = pkgLoading || pmLoading || ordLoading;

  const methodsForSelection = useMemo(() => methods, [methods]);

  const closeDialog = () => {
    setSelected(null);
    setSelectedMethod(null);
    setSenderAccount("");
    setTransactionId("");
    setCryptoCurrency("USDT");
    setPromoApplied(null);
  };

  const handleSubmitOrder = async () => {
    if (!selected || !selectedMethod || !user) return;

    // ── NowPayments auto-crypto flow ──────────────────────────────
    if (selectedMethod.provider === "nowpayments") {
      setSubmitting(true);
      const { data, error } = await supabase.functions.invoke("nowpayments-create-invoice", {
        body: {
          package_id: selected.id,
          promo_code: promoApplied?.code ?? null,
          return_url: window.location.origin + "/shop",
        },
      });
      setSubmitting(false);
      if (error || !data?.invoice_url) {
        toast.error(error?.message || data?.error || "Could not start crypto payment");
        return;
      }
      toast.success("Opening crypto checkout in a new tab…");
      closeDialog();
      qc.invalidateQueries({ queryKey: ["shop", "orders", user.id] });
      // Open in a new tab — NowPayments blocks iframe embedding (X-Frame-Options),
      // which would otherwise white-screen the preview/PWA.
      const opened = window.open(data.invoice_url, "_blank", "noopener,noreferrer");
      if (!opened) {
        // Popup blocked — fall back to top-level navigation so we escape any iframe.
        try {
          (window.top ?? window).location.href = data.invoice_url;
        } catch {
          window.location.href = data.invoice_url;
        }
      }
      return;
    }

    // ── Manual mobile-banking / manual crypto flow ────────────────
    if (!transactionId.trim()) {
      toast.error("Transaction ID din");
      return;
    }
    if (selectedMethod.type !== "crypto" && !senderAccount.trim()) {
      toast.error("Apnar account number din");
      return;
    }
    setSubmitting(true);
    const finalAmount = promoApplied ? promoApplied.final : selected.price;

    let ipAddress: string | null = null;
    try {
      const r = await fetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(2500) });
      if (r.ok) ipAddress = (await r.json())?.ip ?? null;
    } catch {
      /* IP capture optional */
    }

    const { error } = await supabase.from("orders").insert({
      user_id: user.id,
      package_id: selected.id,
      package_name: selected.name,
      amount: finalAmount,
      credits: selected.credits,
      payment_method: selectedMethod.type,
      sender_account: senderAccount.trim(),
      transaction_id: transactionId.trim(),
      crypto_currency: selectedMethod.type === "crypto" ? cryptoCurrency : "",
      status: "pending",
      promo_code: promoApplied?.code ?? null,
      promo_discount: promoApplied?.discount ?? 0,
      promo_bonus_credits: promoApplied?.bonus ?? 0,
      ip_address: ipAddress,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : null,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setConfirmation({
      packageName: selected.name,
      amount: finalAmount,
      credits: selected.credits,
      bonusCredits: promoApplied?.bonus ?? 0,
      methodType: selectedMethod.type,
      transactionId: transactionId.trim(),
      promoCode: promoApplied?.code ?? null,
    });
    closeDialog();
    qc.invalidateQueries({ queryKey: ["shop", "orders", user.id] });
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-[100dvh] grid place-items-center bg-background text-muted-foreground">
        Loading shop…
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <ShopHeader balance={balance} isAdmin={isAdmin} />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-14 pb-28 sm:pb-20">
        <m.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative text-center mb-8 sm:mb-12 py-5 sm:py-12"
        >
          <div className="absolute inset-x-0 -top-4 -bottom-2 bg-editorial pointer-events-none rounded-3xl" aria-hidden />
          <div className="relative">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-[10px] sm:text-[11px] font-semibold text-primary uppercase tracking-[0.22em] mb-3 sm:mb-5">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              Token-based pricing
            </div>
            <h1 className="font-display text-[38px] sm:text-[88px] xl:text-[112px] font-normal leading-[0.95] sm:leading-[0.9] tracking-[-0.045em]">
              Top up your{" "}
              <span className="italic font-black bg-gradient-to-r from-primary via-fuchsia-500 to-primary bg-clip-text text-transparent">credits.</span>
            </h1>
            <p className="mt-3 sm:mt-5 text-[13px] sm:text-[15px] text-muted-foreground max-w-xl mx-auto leading-relaxed px-2">
              Pay only for what the AI actually generates — chat is cheap, full app builds use more.
              Bangladeshi mobile banking and crypto supported.
            </p>
            <div className="mt-5 sm:mt-7 inline-flex items-center gap-5 sm:gap-6 px-5 sm:px-6 py-3 sm:py-3.5 rounded-2xl bg-[hsl(var(--bg-elevated))]/80 backdrop-blur-md border border-border shadow-editorial">
              <div className="text-center">
                <div className="font-display text-[26px] sm:text-[32px] font-black text-primary tabular-nums leading-none">{balance}</div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mt-1.5 font-semibold">Available</div>
              </div>
              <div className="h-9 sm:h-10 w-px bg-border" />
              <div className="text-center">
                <div className="font-display text-[26px] sm:text-[32px] font-black tabular-nums leading-none">{totalPurchased}</div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mt-1.5 font-semibold">Lifetime</div>
              </div>
            </div>
          </div>
        </m.div>

        <AnnouncementsBar />

        <div data-package-grid>
          <PackageGrid packages={packages} isAdmin={isAdmin} onSelect={setSelected} />
        </div>

        <CreditGuide />

        <UserInvoices />

        <OrderHistory orders={orders} />

        <FaqSection />
      </main>

      <BuyDialog
        selected={selected}
        selectedMethod={selectedMethod}
        methods={methodsForSelection}
        senderAccount={senderAccount}
        setSenderAccount={setSenderAccount}
        transactionId={transactionId}
        setTransactionId={setTransactionId}
        cryptoCurrency={cryptoCurrency}
        setCryptoCurrency={setCryptoCurrency}
        promoApplied={promoApplied}
        setPromoApplied={setPromoApplied}
        submitting={submitting}
        onMethodSelect={setSelectedMethod}
        onClearMethod={() => setSelectedMethod(null)}
        onClose={closeDialog}
        onSubmit={handleSubmitOrder}
      />

      <OrderConfirmation
        open={!!confirmation}
        onClose={() => setConfirmation(null)}
        data={confirmation}
      />

      {/* Mobile FAB — quick jump to packages to buy credits */}
      <div className="md:hidden">
        <FAB
          ariaLabel="Buy credits"
          icon={<ShoppingCart className="h-6 w-6" />}
          onClick={() => {
            const grid = document.querySelector("[data-package-grid]");
            if (grid) grid.scrollIntoView({ behavior: "smooth", block: "start" });
            else if (packages[0]) setSelected(packages[0]);
          }}
        />
      </div>
    </div>
  );
};

export default Shop;
