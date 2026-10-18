// Shopping app scaffold — source files that get written to the
// generated project's Daytona sandbox on the first user turn.
//
// Each entry is { path, content }. Paths are relative to the project
// root (i.e. /root/app). Tokens like __APP_NAME__, __PRIMARY__, etc.
// are replaced at write time so each project gets a unique style.

import { ECOMMERCE_SQL } from "./sql.ts";

export type ScaffoldFile = { path: string; content: string };
export type ScaffoldTokens = {
  APP_NAME: string;
  TAGLINE: string;
  PRIMARY: string;          // HSL triplet
  PRIMARY_FG: string;
  ACCENT: string;
  ACCENT_FG: string;
  BG: string; FG: string; CARD: string; MUTED: string; MUTED_FG: string; BORDER: string;
  DBG: string; DFG: string; DCARD: string; DMUTED: string; DMUTED_FG: string; DBORDER: string;
  RADIUS: string;
  FONT: string;
  LAYOUT_VARIANT: string;
};

const indexCss = `@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: __BG__;
    --foreground: __FG__;
    --card: __CARD__;
    --card-foreground: __FG__;
    --popover: __CARD__;
    --popover-foreground: __FG__;
    --primary: __PRIMARY__;
    --primary-foreground: __PRIMARY_FG__;
    --secondary: __MUTED__;
    --secondary-foreground: __FG__;
    --muted: __MUTED__;
    --muted-foreground: __MUTED_FG__;
    --accent: __ACCENT__;
    --accent-foreground: __ACCENT_FG__;
    --destructive: 0 84% 60%;
    --destructive-foreground: 0 0% 100%;
    --border: __BORDER__;
    --input: __BORDER__;
    --ring: __PRIMARY__;
    --radius: __RADIUS__;
  }
  .dark {
    --background: __DBG__;
    --foreground: __DFG__;
    --card: __DCARD__;
    --card-foreground: __DFG__;
    --popover: __DCARD__;
    --popover-foreground: __DFG__;
    --primary: __PRIMARY__;
    --primary-foreground: __PRIMARY_FG__;
    --secondary: __DMUTED__;
    --secondary-foreground: __DFG__;
    --muted: __DMUTED__;
    --muted-foreground: __DMUTED_FG__;
    --accent: __ACCENT__;
    --accent-foreground: __ACCENT_FG__;
    --border: __DBORDER__;
    --input: __DBORDER__;
    --ring: __PRIMARY__;
  }
  * { @apply border-border; }
  html, body, #root { @apply h-full; }
  body { @apply bg-background text-foreground antialiased; font-family: '__FONT__', system-ui, sans-serif; }
}
`;

const tailwindConfig = `import type { Config } from "tailwindcss";
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1rem" },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
      },
      borderRadius: { lg: "var(--radius)", md: "calc(var(--radius) - 2px)", sm: "calc(var(--radius) - 4px)" },
    },
  },
  plugins: [],
} satisfies Config;
`;

const indexHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=1.0, user-scalable=no" />
    <meta name="theme-color" content="hsl(__BG__)" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=__FONT_URL__:wght@400;500;600;700&display=swap" rel="stylesheet" />
    <title>__APP_NAME__</title>
  </head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
`;

const brandTs = `// CUSTOMIZATION SLOT — change app name, tagline, currency, logo.
// The agent should ONLY edit this file (not page layouts) when the user
// asks to rebrand the shop.
export const BRAND = {
  name: "__APP_NAME__",
  tagline: "__TAGLINE__",
  currency: "৳",          // change to "$" / "€" / etc.
  logoUrl: "",            // optional remote logo
  supportEmail: "hello@example.com",
};
`;

const seedTs = `// CUSTOMIZATION SLOT — demo products / categories shown before the user
// connects their Supabase. Once connected, real DB data takes over.
import type { Product, Category } from "@/types";

export const SEED_CATEGORIES: Category[] = [
  { id: "c1", name: "New Arrivals", slug: "new", image_url: "https://picsum.photos/seed/cat1/400/300" },
  { id: "c2", name: "Best Sellers", slug: "best", image_url: "https://picsum.photos/seed/cat2/400/300" },
  { id: "c3", name: "Fashion",      slug: "fashion", image_url: "https://picsum.photos/seed/cat3/400/300" },
  { id: "c4", name: "Electronics",  slug: "electronics", image_url: "https://picsum.photos/seed/cat4/400/300" },
  { id: "c5", name: "Home",         slug: "home", image_url: "https://picsum.photos/seed/cat5/400/300" },
  { id: "c6", name: "Beauty",       slug: "beauty", image_url: "https://picsum.photos/seed/cat6/400/300" },
];

const names = [
  "Linen Shirt","Wireless Earbuds","Ceramic Mug","Leather Wallet","Cotton Tote",
  "Sneakers","Desk Lamp","Sunglasses","Backpack","Watch","Notebook","Speaker",
  "Hoodie","Cap","Perfume","Candle","Bottle","T-shirt","Jeans","Phone Case",
  "Sandals","Tablet Stand","Skincare Set","Kettle",
];

export const SEED_PRODUCTS: Product[] = names.map((n, i) => ({
  id: \`p\${i + 1}\`,
  name: n,
  slug: n.toLowerCase().replace(/\\s+/g, "-") + "-" + (i + 1),
  description: \`Premium quality \${n.toLowerCase()} — crafted with care and built to last.\`,
  price: Number((Math.random() * 90 + 10).toFixed(2)),
  compare_price: Math.random() > 0.5 ? Number((Math.random() * 150 + 50).toFixed(2)) : null,
  image_url: \`https://picsum.photos/seed/p\${i + 10}/600/600\`,
  gallery: [
    \`https://picsum.photos/seed/p\${i + 10}/600/600\`,
    \`https://picsum.photos/seed/p\${i + 20}/600/600\`,
    \`https://picsum.photos/seed/p\${i + 30}/600/600\`,
  ],
  category_id: SEED_CATEGORIES[i % SEED_CATEGORIES.length].id,
  stock: Math.floor(Math.random() * 50) + 5,
  rating: Number((Math.random() * 1 + 4).toFixed(1)),
  is_active: true,
}));
`;

const typesTs = `export type Category = {
  id: string; name: string; slug: string; image_url?: string | null;
};
export type Product = {
  id: string; name: string; slug: string; description: string;
  price: number; compare_price?: number | null;
  image_url?: string | null; gallery: string[];
  category_id?: string | null; stock: number; rating: number; is_active: boolean;
};
export type CartLine = { product: Product; qty: number };
export type Order = {
  id: string; user_id: string; status: string;
  subtotal: number; shipping: number; total: number;
  shipping_address: any; payment_method?: string | null;
  created_at: string;
  items?: Array<{ id: string; name: string; price: number; quantity: number; image_url?: string | null }>;
};
`;

const supabaseClient = `import { createClient } from "@supabase/supabase-js";
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;
export const supabase = url && key ? createClient(url, key) : null;
export const hasSupabase = !!supabase;
`;

const cartCtx = `import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CartLine, Product } from "@/types";
import { supabase } from "@/lib/supabase";

type Ctx = {
  lines: CartLine[];
  add: (p: Product, qty?: number) => void;
  remove: (id: string) => void;
  setQty: (id: string, qty: number) => void;
  clear: () => void;
  count: number;
  subtotal: number;
};
const CartCtx = createContext<Ctx | null>(null);
const KEY = "__APP_NAME___cart_v1";

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(() => {
    try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
  });
  const userIdRef = useRef<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Persist to localStorage as fallback (works when logged out).
  useEffect(() => { localStorage.setItem(KEY, JSON.stringify(lines)); }, [lines]);

  // When user logs in, hydrate from cart_items and keep in sync.
  useEffect(() => {
    if (!supabase) { setHydrated(true); return; }
    const sub = supabase.auth.onAuthStateChange(async (_e, session) => {
      const uid = session?.user?.id ?? null;
      userIdRef.current = uid;
      if (!uid) { setHydrated(true); return; }
      const { data } = await supabase!.from("cart_items").select("quantity, products(*)").eq("user_id", uid);
      const remote: CartLine[] = (data ?? []).map((r: any) => ({ product: r.products as Product, qty: r.quantity })).filter((l) => l.product);
      if (remote.length) setLines(remote);
      setHydrated(true);
    });
    return () => sub.data.subscription.unsubscribe();
  }, []);

  // Push every change to cart_items (upsert) for logged-in users.
  const syncLine = async (productId: string, qty: number) => {
    const uid = userIdRef.current; if (!uid || !supabase) return;
    if (qty <= 0) await supabase.from("cart_items").delete().eq("user_id", uid).eq("product_id", productId);
    else await supabase.from("cart_items").upsert({ user_id: uid, product_id: productId, quantity: qty }, { onConflict: "user_id,product_id" });
  };

  const add = (p: Product, qty = 1) => setLines((ls) => {
    const found = ls.find((l) => l.product.id === p.id);
    const next = found ? ls.map((l) => l.product.id === p.id ? { ...l, qty: l.qty + qty } : l) : [...ls, { product: p, qty }];
    const newQty = (found?.qty ?? 0) + qty;
    void syncLine(p.id, newQty);
    return next;
  });
  const remove = (id: string) => setLines((ls) => { void syncLine(id, 0); return ls.filter((l) => l.product.id !== id); });
  const setQty = (id: string, qty: number) => setLines((ls) => {
    void syncLine(id, qty);
    return qty <= 0 ? ls.filter((l) => l.product.id !== id) : ls.map((l) => l.product.id === id ? { ...l, qty } : l);
  });
  const clear = () => {
    const uid = userIdRef.current;
    if (uid && supabase) void supabase.from("cart_items").delete().eq("user_id", uid);
    setLines([]);
  };

  const count = useMemo(() => lines.reduce((s, l) => s + l.qty, 0), [lines]);
  const subtotal = useMemo(() => lines.reduce((s, l) => s + l.qty * l.product.price, 0), [lines]);

  return <CartCtx.Provider value={{ lines, add, remove, setQty, clear, count, subtotal }}>{children}</CartCtx.Provider>;
}
export function useCart() {
  const c = useContext(CartCtx);
  if (!c) throw new Error("useCart must be used within CartProvider");
  return c;
}
`;

const authHook = `import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export function useAuth() {
  const [user, setUser] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        const { data } = await supabase.from("user_roles").select("role").eq("user_id", session.user.id);
        setIsAdmin(!!data?.some((r: any) => r.role === "admin"));
      } else setIsAdmin(false);
    });
    supabase.auth.getSession().then(async ({ data }) => {
      setUser(data.session?.user ?? null);
      if (data.session?.user) {
        const { data: roles } = await supabase!.from("user_roles").select("role").eq("user_id", data.session.user.id);
        setIsAdmin(!!roles?.some((r: any) => r.role === "admin"));
      }
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return { user, isAdmin, loading };
}
`;

const productsRepo = `import { supabase } from "@/lib/supabase";
import { SEED_PRODUCTS, SEED_CATEGORIES } from "@/lib/seed";
import type { Product, Category } from "@/types";

export async function listCategories(): Promise<Category[]> {
  if (!supabase) return SEED_CATEGORIES;
  const { data } = await supabase.from("categories").select("*").order("sort_order");
  return (data as Category[] | null) ?? SEED_CATEGORIES;
}
export async function listProducts(opts: { categoryId?: string; search?: string } = {}): Promise<Product[]> {
  if (!supabase) {
    let list = SEED_PRODUCTS;
    if (opts.categoryId) list = list.filter((p) => p.category_id === opts.categoryId);
    if (opts.search) list = list.filter((p) => p.name.toLowerCase().includes(opts.search!.toLowerCase()));
    return list;
  }
  let q = supabase.from("products").select("*").eq("is_active", true);
  if (opts.categoryId) q = q.eq("category_id", opts.categoryId);
  if (opts.search) q = q.ilike("name", \`%\${opts.search}%\`);
  const { data } = await q;
  return (data as Product[] | null) ?? [];
}
export async function getProduct(id: string): Promise<Product | null> {
  if (!supabase) return SEED_PRODUCTS.find((p) => p.id === id) ?? null;
  const { data } = await supabase.from("products").select("*").eq("id", id).maybeSingle();
  return (data as Product | null) ?? null;
}
`;

const ordersRepo = `import { supabase } from "@/lib/supabase";
import type { CartLine, Order } from "@/types";

export async function createOrder(args: {
  userId: string; lines: CartLine[]; shipping_address: any; payment_method: string;
  subtotal: number; shipping: number;
}): Promise<{ id: string } | { error: string }> {
  if (!supabase) return { error: "Backend not connected. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env, then run the SQL migration." };
  const total = args.subtotal + args.shipping;
  const { data: order, error } = await supabase.from("orders").insert({
    user_id: args.userId, subtotal: args.subtotal, shipping: args.shipping, total,
    shipping_address: args.shipping_address, payment_method: args.payment_method,
  }).select("id").single();
  if (error || !order) return { error: error?.message || "Failed to create order" };
  const items = args.lines.map((l) => ({
    order_id: order.id, product_id: l.product.id, name: l.product.name,
    price: l.product.price, quantity: l.qty, image_url: l.product.image_url,
  }));
  await supabase.from("order_items").insert(items);
  return { id: order.id };
}
export async function listOrders(userId: string): Promise<Order[]> {
  if (!supabase) return [];
  const { data } = await supabase.from("orders").select("*, items:order_items(*)").eq("user_id", userId).order("created_at", { ascending: false });
  return (data as Order[] | null) ?? [];
}
export async function listAllOrders(): Promise<Order[]> {
  if (!supabase) return [];
  const { data } = await supabase.from("orders").select("*, items:order_items(*)").order("created_at", { ascending: false });
  return (data as Order[] | null) ?? [];
}
`;

export const ECOMMERCE_LIB_FILES: ScaffoldFile[] = [
  { path: "src/index.css", content: indexCss },
  { path: "tailwind.config.ts", content: tailwindConfig },
  { path: "index.html", content: indexHtml },
  { path: "src/lib/brand.ts", content: brandTs },
  { path: "src/lib/seed.ts", content: seedTs },
  { path: "src/types.ts", content: typesTs },
  { path: "src/lib/supabase.ts", content: supabaseClient },
  { path: "src/lib/cart.tsx", content: cartCtx },
  { path: "src/hooks/useAuth.ts", content: authHook },
  { path: "src/lib/repo/products.ts", content: productsRepo },
  { path: "src/lib/repo/orders.ts", content: ordersRepo },
  { path: "supabase/migrations/0001_init.sql", content: ECOMMERCE_SQL },
  { path: ".env.example", content: `VITE_SUPABASE_URL=\nVITE_SUPABASE_PUBLISHABLE_KEY=\n` },
];
