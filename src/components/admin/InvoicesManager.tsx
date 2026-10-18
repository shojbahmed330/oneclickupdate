import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileText, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { VirtualList } from "@/components/ui/VirtualList";
import { supabase } from "@/integrations/supabase/client";
import { useAppSettings } from "@/hooks/useAppSettings";
import { useDebounce } from "@/hooks/useDebounce";
import { downloadInvoicePdf } from "@/lib/invoice";
import { toast } from "sonner";

type Row = {
  id: string;
  invoice_number: string;
  user_id: string;
  order_id: string;
  subtotal: number;
  vat_percent: number;
  vat_amount: number;
  total: number;
  currency: string;
  issued_at: string;
};

const InvoiceRow = ({ r, onDownload }: { r: Row; onDownload: (r: Row) => void }) => (
  <div className="flex flex-wrap items-center gap-2 sm:gap-3 p-3 sm:p-4 rounded-lg bg-[hsl(var(--bg-elevated))] border border-[hsl(0_0%_100%/0.08)] mb-2">
    <FileText size={16} className="text-primary shrink-0" />
    <div className="flex-1 min-w-0">
      <div className="font-medium font-mono text-xs sm:text-sm truncate">{r.invoice_number}</div>
      <div className="text-[11px] sm:text-xs text-muted-foreground truncate">
        {new Date(r.issued_at).toLocaleString()} · {r.order_id.slice(0, 8)}…
      </div>
    </div>
    <div className="flex items-center gap-1.5 ml-auto flex-wrap justify-end">
      <Badge variant="outline" className="text-[10px] sm:text-xs whitespace-nowrap">
        {r.currency} {Number(r.total).toFixed(2)}
      </Badge>
      {r.vat_percent > 0 && <Badge variant="outline" className="text-[10px]">VAT {r.vat_percent}%</Badge>}
      <Button size="sm" variant="ghost" onClick={() => onDownload(r)} leftIcon={<Download size={14} />}>
        PDF
      </Button>
    </div>
  </div>
);

const PAGE_SIZE = 50;

export const InvoicesManager = () => {
  const { settings } = useAppSettings();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const debouncedQ = useDebounce(q, 300);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-invoices", page],
    queryFn: async (): Promise<{ rows: Row[]; count: number }> => {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const { data, count } = await supabase
        .from("invoices")
        .select("*", { count: "exact" })
        .order("issued_at", { ascending: false })
        .range(from, to);
      return { rows: (data ?? []) as Row[], count: count ?? 0 };
    },
    staleTime: 60_000,
  });
  const rows = data?.rows ?? [];
  const total = data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const filtered = useMemo(
    () => rows.filter((r) => r.invoice_number.toLowerCase().includes(debouncedQ.toLowerCase())),
    [rows, debouncedQ],
  );

  const download = async (r: Row) => {
    const [{ data: order }, { data: profile }] = await Promise.all([
      supabase.from("orders").select("*").eq("id", r.order_id).maybeSingle(),
      supabase.from("profiles").select("display_name").eq("user_id", r.user_id).maybeSingle(),
    ]);
    if (!order) return toast.error("Order not found");
    downloadInvoicePdf({
      invoice_number: r.invoice_number,
      issued_at: r.issued_at,
      subtotal: r.subtotal,
      vat_percent: r.vat_percent,
      vat_amount: r.vat_amount,
      total: r.total,
      currency: r.currency,
      package_name: order.package_name,
      credits: order.credits,
      payment_method: order.payment_method,
      transaction_id: order.transaction_id,
      order_id: r.order_id,
      customer_name: profile?.display_name ?? "Customer",
      customer_email: "",
      site_name: settings.site_name,
      contact_email: settings.contact_email,
      contact_phone: settings.contact_phone,
    });
  };

  // Virtualize when 20+ rows for smooth scrolling
  const useVirtual = filtered.length >= 20;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input
          leftIcon={<Search size={14} />}
          placeholder="Search invoice #"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">No invoices yet.</div>
      ) : useVirtual ? (
        <VirtualList items={filtered} rowHeight={88} height={Math.min(600, filtered.length * 88)}>
          {(r) => <InvoiceRow r={r} onDownload={download} />}
        </VirtualList>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <InvoiceRow key={r.id} r={r} onDownload={download} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-2 pt-2">
          <div className="text-xs text-muted-foreground">
            Page {page + 1} of {totalPages} · {total} total
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              Previous
            </Button>
            <Button size="sm" variant="secondary" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
