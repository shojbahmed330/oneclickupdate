// jsPDF is dynamically imported inside downloadInvoicePdf so the ~400KB
// PDF library never enters the main bundle — only loaded when an invoice
// is actually downloaded.

export type InvoiceData = {
  invoice_number: string;
  issued_at: string;
  subtotal: number;
  vat_percent: number;
  vat_amount: number;
  total: number;
  currency: string;
  // Order
  package_name: string;
  credits: number;
  payment_method: string;
  transaction_id?: string | null;
  order_id: string;
  // Customer
  customer_name: string;
  customer_email: string;
  // Site
  site_name: string;
  contact_email?: string;
  contact_phone?: string;
};

const money = (n: number, c: string) =>
  `${c === "BDT" ? "Tk " : c + " "}${Number(n).toFixed(2)}`;

// Premium A4 invoice — accent header, clean grid, subtle dividers.
export const downloadInvoicePdf = async (d: InvoiceData) => {
  const { default: jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 48;

  // Brand palette
  const ink = [15, 23, 42] as const;          // slate-900
  const sub = [100, 116, 139] as const;       // slate-500
  const line = [226, 232, 240] as const;      // slate-200
  const tint = [248, 250, 252] as const;      // slate-50
  const accent = [99, 102, 241] as const;     // indigo-500

  // ── Top accent bar ───────────────────────────────────────────────
  doc.setFillColor(...accent);
  doc.rect(0, 0, W, 6, "F");

  // ── Header: brand + invoice meta ─────────────────────────────────
  doc.setTextColor(...ink);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text(d.site_name || "Invoice", M, 60);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...sub);
  let cy = 76;
  if (d.contact_email) { doc.text(d.contact_email, M, cy); cy += 12; }
  if (d.contact_phone) { doc.text(d.contact_phone, M, cy); }

  // Right side: INVOICE label + number
  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  doc.setTextColor(...ink);
  doc.text("INVOICE", W - M, 58, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...sub);
  doc.text("Invoice number", W - M, 76, { align: "right" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...ink);
  doc.text(d.invoice_number, W - M, 90, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...sub);
  doc.text("Issued", W - M, 106, { align: "right" });
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...ink);
  doc.text(new Date(d.issued_at).toLocaleString(), W - M, 118, { align: "right" });

  // Divider
  let y = 142;
  doc.setDrawColor(...line);
  doc.setLineWidth(0.6);
  doc.line(M, y, W - M, y);

  // ── Bill-to + Order meta (two columns) ───────────────────────────
  y += 22;
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...sub);
  doc.text("BILLED TO", M, y);
  doc.text("ORDER DETAILS", W / 2 + 10, y);

  y += 14;
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...ink);
  doc.text(d.customer_name || "Customer", M, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...sub);
  doc.text(d.customer_email || "", M, y + 14);

  // Order column
  const cx = W / 2 + 10;
  let oy = y;
  doc.setFontSize(9);
  doc.setTextColor(...sub);
  doc.text("Order ID", cx, oy);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...ink);
  doc.text(d.order_id.slice(0, 8).toUpperCase(), cx + 70, oy);

  oy += 14;
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...sub);
  doc.text("Method", cx, oy);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...ink);
  doc.text(String(d.payment_method).toUpperCase(), cx + 70, oy);

  if (d.transaction_id) {
    oy += 14;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...sub);
    doc.text("Txn ID", cx, oy);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...ink);
    doc.text(d.transaction_id, cx + 70, oy);
  }

  // ── Line items table ─────────────────────────────────────────────
  y = Math.max(y + 50, oy + 30);

  // Header row
  doc.setFillColor(...tint);
  doc.rect(M, y, W - M * 2, 30, "F");
  // Accent left edge
  doc.setFillColor(...accent);
  doc.rect(M, y, 3, 30, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...sub);
  doc.text("DESCRIPTION", M + 14, y + 19);
  doc.text("QTY", W - M - 180, y + 19);
  doc.text("AMOUNT", W - M - 14, y + 19, { align: "right" });

  y += 30;
  // Item row
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...ink);
  doc.text(d.package_name, M + 14, y + 22);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...sub);
  doc.text(`${d.credits} credits included`, M + 14, y + 36);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(...ink);
  doc.text(String(d.credits), W - M - 180, y + 22);
  doc.text(money(d.subtotal, d.currency), W - M - 14, y + 22, { align: "right" });

  y += 56;
  doc.setDrawColor(...line);
  doc.line(M, y, W - M, y);

  // ── Totals box (right aligned) ───────────────────────────────────
  y += 18;
  const lblX = W - M - 200;
  const valX = W - M - 14;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...sub);
  doc.text("Subtotal", lblX, y);
  doc.setTextColor(...ink);
  doc.text(money(d.subtotal, d.currency), valX, y, { align: "right" });

  y += 18;
  doc.setTextColor(...sub);
  doc.text(`VAT (${d.vat_percent}%)`, lblX, y);
  doc.setTextColor(...ink);
  doc.text(money(d.vat_amount, d.currency), valX, y, { align: "right" });

  // Total row — accent background
  y += 16;
  doc.setFillColor(...ink);
  doc.rect(lblX - 12, y, W - M - lblX + 12, 36, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(255);
  doc.text("TOTAL DUE", lblX, y + 22);
  doc.setFontSize(15);
  doc.text(money(d.total, d.currency), valX, y + 23, { align: "right" });

  // ── Status pill (PAID) ───────────────────────────────────────────
  y += 60;
  doc.setFillColor(16, 185, 129); // emerald-500
  const pillW = 70;
  doc.roundedRect(M, y, pillW, 22, 11, 11, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(255);
  doc.text("PAID", M + pillW / 2, y + 15, { align: "center" });

  // ── Footer ───────────────────────────────────────────────────────
  doc.setDrawColor(...line);
  doc.line(M, H - 60, W - M, H - 60);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...sub);
  doc.text(
    `Thank you for your purchase. Generated by ${d.site_name}.`,
    W / 2,
    H - 38,
    { align: "center" }
  );
  doc.setFontSize(8);
  doc.text(
    "This is a computer-generated invoice and does not require a signature.",
    W / 2,
    H - 24,
    { align: "center" }
  );

  doc.save(`${d.invoice_number}.pdf`);
};
