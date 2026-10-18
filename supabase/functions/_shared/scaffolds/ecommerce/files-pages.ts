// Page + component source files for the e-commerce scaffold.
import type { ScaffoldFile } from "./files-lib.ts";

const mainTsx = `import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Routes, Route } from "react-router-dom";
import App from "./App";
import Home from "./pages/Home";
import Category from "./pages/Category";
import Product from "./pages/Product";
import Cart from "./pages/Cart";
import Checkout from "./pages/Checkout";
import Orders from "./pages/Orders";
import Profile from "./pages/Profile";
import Auth from "./pages/Auth";
import AdminLayout from "./pages/admin/AdminLayout";
import AdminProducts from "./pages/admin/AdminProducts";
import AdminOrders from "./pages/admin/AdminOrders";
import AdminUsers from "./pages/admin/AdminUsers";
import AdminDashboard from "./pages/admin/AdminDashboard";
import { CartProvider } from "./lib/cart";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <CartProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<App />}>
            <Route index element={<Home />} />
            <Route path="category/:slug" element={<Category />} />
            <Route path="product/:id" element={<Product />} />
            <Route path="cart" element={<Cart />} />
            <Route path="checkout" element={<Checkout />} />
            <Route path="orders" element={<Orders />} />
            <Route path="profile" element={<Profile />} />
            <Route path="auth" element={<Auth />} />
            <Route path="admin" element={<AdminLayout />}>
              <Route index element={<AdminDashboard />} />
              <Route path="products" element={<AdminProducts />} />
              <Route path="orders" element={<AdminOrders />} />
              <Route path="users" element={<AdminUsers />} />
            </Route>
          </Route>
        </Routes>
      </HashRouter>
    </CartProvider>
  </React.StrictMode>
);
`;

const appTsx = `import { Outlet, useLocation } from "react-router-dom";
import BottomNav from "@/components/mobile/BottomNav";

export default function App() {
  const loc = useLocation();
  const hideNav = loc.pathname.startsWith("/auth") || loc.pathname.startsWith("/admin");
  return (
    <div className="min-h-[100dvh] w-full flex flex-col bg-background text-foreground">
      <main className="flex-1 overflow-y-auto overscroll-contain pb-[calc(72px+env(safe-area-inset-bottom)+8px)]">
        <Outlet />
      </main>
      {!hideNav && <BottomNav />}
    </div>
  );
}
`;

const bottomNav = `import { NavLink } from "react-router-dom";
import { Home, ShoppingBag, ShoppingCart, ClipboardList, User } from "lucide-react";
import { useCart } from "@/lib/cart";

const tabs = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/category/all", label: "Shop", icon: ShoppingBag },
  { to: "/cart", label: "Cart", icon: ShoppingCart, badge: true },
  { to: "/orders", label: "Orders", icon: ClipboardList },
  { to: "/profile", label: "Profile", icon: User },
];

export default function BottomNav() {
  const { count } = useCart();
  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 bg-background/90 backdrop-blur-xl border-t border-border pb-[env(safe-area-inset-bottom)]">
      <div className="grid grid-cols-5 h-[72px]">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <NavLink key={t.to} to={t.to} end={t.end as any}
              className={({ isActive }) =>
                \`flex flex-col items-center justify-center gap-1 text-[11px] active:scale-95 transition \${isActive ? "text-primary" : "text-muted-foreground"}\`}>
              <div className="relative">
                <Icon className="h-5 w-5" />
                {t.badge && count > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">{count}</span>
                )}
              </div>
              <span>{t.label}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
`;

const productCard = `import { Link } from "react-router-dom";
import { Star } from "lucide-react";
import type { Product } from "@/types";
import { BRAND } from "@/lib/brand";

export default function ProductCard({ p }: { p: Product }) {
  return (
    <Link to={\`/product/\${p.id}\`} className="group block active:scale-[0.98] transition">
      <div className="aspect-square overflow-hidden rounded-2xl bg-muted">
        <img src={p.image_url ?? ""} alt={p.name} loading="lazy"
          className="h-full w-full object-cover group-hover:scale-105 transition duration-500" />
      </div>
      <div className="pt-2 space-y-1">
        <div className="text-sm font-medium line-clamp-1">{p.name}</div>
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold">{BRAND.currency}{p.price.toFixed(2)}</span>
          {p.compare_price && p.compare_price > p.price && (
            <span className="text-xs text-muted-foreground line-through">{BRAND.currency}{p.compare_price.toFixed(2)}</span>
          )}
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Star className="h-3 w-3 fill-current text-accent" /> {p.rating}
        </div>
      </div>
    </Link>
  );
}
`;

const homePage = `import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Search, Bell } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { listCategories, listProducts } from "@/lib/repo/products";
import type { Category, Product } from "@/types";
import ProductCard from "@/components/product/ProductCard";

export default function Home() {
  const [cats, setCats] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [q, setQ] = useState("");
  useEffect(() => { listCategories().then(setCats); listProducts().then(setProducts); }, []);
  const filtered = q ? products.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())) : products;

  return (
    <div className="space-y-6">
      <header className="sticky top-0 z-30 bg-background/85 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center justify-between">
        <div>
          <div className="text-xs text-muted-foreground">Welcome to</div>
          <div className="text-lg font-bold tracking-tight">{BRAND.name}</div>
        </div>
        <button className="h-10 w-10 rounded-full bg-muted grid place-items-center active:scale-95 transition" aria-label="Notifications">
          <Bell className="h-5 w-5" />
        </button>
      </header>

      <div className="px-4">
        <label className="flex items-center gap-2 h-12 rounded-2xl bg-muted px-4">
          <Search className="h-5 w-5 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search products…" className="flex-1 bg-transparent outline-none text-sm" />
        </label>
      </div>

      <section className="px-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Categories</h2>
          <Link to="/category/all" className="text-xs text-primary">See all</Link>
        </div>
        <div className="flex gap-3 overflow-x-auto -mx-4 px-4 pb-1">
          {cats.map((c) => (
            <Link key={c.id} to={\`/category/\${c.slug}\`}
              className="flex-none w-20 text-center active:scale-95 transition">
              <div className="h-16 w-16 mx-auto rounded-2xl bg-muted overflow-hidden">
                {c.image_url && <img src={c.image_url} alt={c.name} className="h-full w-full object-cover" />}
              </div>
              <div className="text-[11px] mt-1 line-clamp-1">{c.name}</div>
            </Link>
          ))}
        </div>
      </section>

      <section className="px-4 space-y-3">
        <h2 className="text-sm font-semibold">{q ? "Results" : "Featured"}</h2>
        <div className="grid grid-cols-2 gap-3">
          {filtered.map((p) => <ProductCard key={p.id} p={p} />)}
          {filtered.length === 0 && <div className="col-span-2 text-center text-sm text-muted-foreground py-12">No products found.</div>}
        </div>
      </section>
    </div>
  );
}
`;

const categoryPage = `import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { listCategories, listProducts } from "@/lib/repo/products";
import type { Category, Product } from "@/types";
import ProductCard from "@/components/product/ProductCard";

export default function CategoryPage() {
  const { slug } = useParams();
  const nav = useNavigate();
  const [cats, setCats] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [active, setActive] = useState<string | "all">(slug === "all" ? "all" : "all");

  useEffect(() => { listCategories().then(setCats); }, []);
  useEffect(() => {
    if (!cats.length) return;
    const target = cats.find((c) => c.slug === slug);
    setActive(target ? target.id : "all");
  }, [slug, cats]);
  useEffect(() => {
    listProducts(active === "all" ? {} : { categoryId: active }).then(setProducts);
  }, [active]);

  return (
    <div className="space-y-4">
      <header className="sticky top-0 z-30 bg-background/85 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3">
        <button onClick={() => nav(-1)} className="h-9 w-9 rounded-full bg-muted grid place-items-center active:scale-95"><ArrowLeft className="h-4 w-4" /></button>
        <h1 className="text-base font-semibold">Shop</h1>
      </header>
      <div className="flex gap-2 overflow-x-auto px-4 pb-1">
        <button onClick={() => setActive("all")}
          className={\`h-8 px-3 rounded-full text-xs whitespace-nowrap active:scale-95 transition \${active === "all" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}\`}>All</button>
        {cats.map((c) => (
          <Link key={c.id} to={\`/category/\${c.slug}\`}
            className={\`h-8 px-3 rounded-full text-xs whitespace-nowrap flex items-center active:scale-95 transition \${active === c.id ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}\`}>
            {c.name}
          </Link>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 px-4">
        {products.map((p) => <ProductCard key={p.id} p={p} />)}
        {products.length === 0 && <div className="col-span-2 text-center text-sm text-muted-foreground py-12">No products in this category.</div>}
      </div>
    </div>
  );
}
`;

const productPage = `import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Heart, Minus, Plus, ShoppingBag, Star } from "lucide-react";
import { getProduct } from "@/lib/repo/products";
import type { Product } from "@/types";
import { useCart } from "@/lib/cart";
import { BRAND } from "@/lib/brand";

export default function ProductPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { add } = useCart();
  const [p, setP] = useState<Product | null>(null);
  const [qty, setQty] = useState(1);
  const [active, setActive] = useState(0);

  useEffect(() => { if (id) getProduct(id).then(setP); }, [id]);
  if (!p) return <div className="p-8 text-center text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-4 pb-32">
      <div className="relative">
        <img src={p.gallery?.[active] || p.image_url || ""} alt={p.name} className="w-full aspect-square object-cover" />
        <button onClick={() => nav(-1)} className="absolute top-3 left-3 h-10 w-10 rounded-full bg-background/90 backdrop-blur grid place-items-center active:scale-95"><ArrowLeft className="h-4 w-4" /></button>
        <button className="absolute top-3 right-3 h-10 w-10 rounded-full bg-background/90 backdrop-blur grid place-items-center active:scale-95"><Heart className="h-4 w-4" /></button>
      </div>
      {p.gallery && p.gallery.length > 1 && (
        <div className="flex gap-2 px-4 overflow-x-auto">
          {p.gallery.map((g, i) => (
            <button key={i} onClick={() => setActive(i)}
              className={\`h-16 w-16 flex-none rounded-xl overflow-hidden border-2 \${active === i ? "border-primary" : "border-transparent"}\`}>
              <img src={g} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
      <div className="px-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-xl font-bold tracking-tight">{p.name}</h1>
          <div className="flex items-center gap-1 text-sm"><Star className="h-4 w-4 fill-current text-accent" /> {p.rating}</div>
        </div>
        <div className="flex items-baseline gap-3">
          <span className="text-2xl font-bold">{BRAND.currency}{p.price.toFixed(2)}</span>
          {p.compare_price && p.compare_price > p.price && <span className="text-sm text-muted-foreground line-through">{BRAND.currency}{p.compare_price.toFixed(2)}</span>}
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">{p.description}</p>
        <div className="flex items-center gap-3 pt-2">
          <div className="flex items-center gap-1 rounded-full border border-border">
            <button onClick={() => setQty(Math.max(1, qty - 1))} className="h-10 w-10 grid place-items-center active:scale-90"><Minus className="h-4 w-4" /></button>
            <span className="w-8 text-center text-sm font-medium">{qty}</span>
            <button onClick={() => setQty(qty + 1)} className="h-10 w-10 grid place-items-center active:scale-90"><Plus className="h-4 w-4" /></button>
          </div>
          <span className="text-xs text-muted-foreground">{p.stock} in stock</span>
        </div>
      </div>
      <div className="fixed bottom-[72px] inset-x-0 z-30 bg-background/95 backdrop-blur border-t border-border p-3 flex gap-2">
        <button onClick={() => { add(p, qty); }} className="flex-1 h-12 rounded-2xl bg-muted text-foreground font-medium flex items-center justify-center gap-2 active:scale-[0.97]">
          <ShoppingBag className="h-4 w-4" /> Add to cart
        </button>
        <button onClick={() => { add(p, qty); nav("/cart"); }} className="flex-1 h-12 rounded-2xl bg-primary text-primary-foreground font-semibold active:scale-[0.97]">Buy now</button>
      </div>
    </div>
  );
}
`;

const cartPage = `import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Minus, Plus, Trash2 } from "lucide-react";
import { useCart } from "@/lib/cart";
import { BRAND } from "@/lib/brand";

export default function CartPage() {
  const nav = useNavigate();
  const { lines, setQty, remove, subtotal, count } = useCart();

  if (count === 0) return (
    <div className="min-h-[80dvh] flex flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="text-6xl">🛒</div>
      <div className="text-lg font-semibold">Your cart is empty</div>
      <p className="text-sm text-muted-foreground">Browse our products and find something you love.</p>
      <Link to="/" className="mt-2 h-11 px-6 rounded-2xl bg-primary text-primary-foreground font-medium grid place-items-center active:scale-95">Start shopping</Link>
    </div>
  );

  return (
    <div className="pb-32">
      <header className="sticky top-0 z-30 bg-background/85 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3">
        <button onClick={() => nav(-1)} className="h-9 w-9 rounded-full bg-muted grid place-items-center"><ArrowLeft className="h-4 w-4" /></button>
        <h1 className="text-base font-semibold">Your Cart ({count})</h1>
      </header>
      <ul className="divide-y divide-border px-4">
        {lines.map((l) => (
          <li key={l.product.id} className="py-3 flex gap-3">
            <img src={l.product.image_url ?? ""} alt={l.product.name} className="h-20 w-20 rounded-xl object-cover bg-muted" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium line-clamp-1">{l.product.name}</div>
              <div className="text-sm font-semibold mt-1">{BRAND.currency}{(l.product.price * l.qty).toFixed(2)}</div>
              <div className="flex items-center gap-2 mt-2">
                <div className="flex items-center gap-1 rounded-full border border-border">
                  <button onClick={() => setQty(l.product.id, l.qty - 1)} className="h-8 w-8 grid place-items-center active:scale-90"><Minus className="h-3.5 w-3.5" /></button>
                  <span className="w-6 text-center text-xs">{l.qty}</span>
                  <button onClick={() => setQty(l.product.id, l.qty + 1)} className="h-8 w-8 grid place-items-center active:scale-90"><Plus className="h-3.5 w-3.5" /></button>
                </div>
                <button onClick={() => remove(l.product.id)} className="ml-auto h-8 w-8 grid place-items-center text-destructive active:scale-90"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <div className="fixed bottom-[72px] inset-x-0 z-30 bg-background/95 backdrop-blur border-t border-border p-4 space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="font-semibold">{BRAND.currency}{subtotal.toFixed(2)}</span>
        </div>
        <button onClick={() => nav("/checkout")} className="h-12 w-full rounded-2xl bg-primary text-primary-foreground font-semibold active:scale-[0.97]">Checkout</button>
      </div>
    </div>
  );
}
`;

const checkoutPage = `import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useCart } from "@/lib/cart";
import { useAuth } from "@/hooks/useAuth";
import { createOrder } from "@/lib/repo/orders";
import { BRAND } from "@/lib/brand";

export default function Checkout() {
  const nav = useNavigate();
  const { user } = useAuth();
  const { lines, subtotal, clear } = useCart();
  const shipping = subtotal > 100 ? 0 : 5;
  const [form, setForm] = useState({ name: "", phone: "", address: "", city: "" });
  const [pay, setPay] = useState("cod");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!user) { nav("/auth"); return; }
    setSubmitting(true); setError(null);
    const res = await createOrder({
      userId: user.id, lines, subtotal, shipping,
      shipping_address: form, payment_method: pay,
    });
    setSubmitting(false);
    if ("error" in res) { setError(res.error); return; }
    clear();
    nav("/orders");
  };

  return (
    <div className="pb-28">
      <header className="sticky top-0 z-30 bg-background/85 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3">
        <button onClick={() => nav(-1)} className="h-9 w-9 rounded-full bg-muted grid place-items-center"><ArrowLeft className="h-4 w-4" /></button>
        <h1 className="text-base font-semibold">Checkout</h1>
      </header>
      <div className="p-4 space-y-5">
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Shipping address</h2>
          {(["name","phone","address","city"] as const).map((k) => (
            <input key={k} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              placeholder={k[0].toUpperCase() + k.slice(1)}
              className="h-11 w-full rounded-xl bg-muted px-4 text-sm outline-none focus:ring-2 ring-primary" />
          ))}
        </section>
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Payment</h2>
          {[{id:"cod",label:"Cash on delivery"},{id:"card",label:"Card"},{id:"bkash",label:"bKash / mobile wallet"}].map((opt) => (
            <label key={opt.id} className={\`flex items-center justify-between h-12 rounded-xl px-4 cursor-pointer border \${pay===opt.id?"border-primary bg-primary/5":"border-border bg-card"}\`}>
              <span className="text-sm">{opt.label}</span>
              <input type="radio" checked={pay===opt.id} onChange={() => setPay(opt.id)} />
            </label>
          ))}
        </section>
        <section className="rounded-2xl border border-border p-4 space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{BRAND.currency}{subtotal.toFixed(2)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Shipping</span><span>{shipping === 0 ? "Free" : \`\${BRAND.currency}\${shipping.toFixed(2)}\`}</span></div>
          <div className="flex justify-between text-base font-semibold pt-2 border-t border-border"><span>Total</span><span>{BRAND.currency}{(subtotal+shipping).toFixed(2)}</span></div>
        </section>
        {error && <div className="text-sm text-destructive">{error}</div>}
        <button onClick={submit} disabled={submitting || lines.length === 0}
          className="h-12 w-full rounded-2xl bg-primary text-primary-foreground font-semibold active:scale-[0.97] disabled:opacity-50">
          {submitting ? "Placing order…" : "Place order"}
        </button>
        {!user && <p className="text-xs text-center text-muted-foreground">You'll be asked to sign in to complete the order.</p>}
      </div>
    </div>
  );
}
`;

const ordersPage = `import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { listOrders } from "@/lib/repo/orders";
import type { Order } from "@/types";
import { BRAND } from "@/lib/brand";

export default function OrdersPage() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  useEffect(() => { if (user) listOrders(user.id).then(setOrders); }, [user]);

  if (!user) return (
    <div className="min-h-[70dvh] flex flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="text-5xl">📦</div>
      <p className="text-sm text-muted-foreground">Sign in to view your orders.</p>
      <Link to="/auth" className="h-11 px-6 rounded-2xl bg-primary text-primary-foreground font-medium grid place-items-center">Sign in</Link>
    </div>
  );

  return (
    <div className="pb-8">
      <header className="sticky top-0 z-30 bg-background/85 backdrop-blur-xl border-b border-border px-4 py-3">
        <h1 className="text-lg font-bold">Your Orders</h1>
      </header>
      <ul className="p-4 space-y-3">
        {orders.map((o) => (
          <li key={o.id} className="rounded-2xl border border-border p-4 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground">#{o.id.slice(0, 8)}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-accent text-accent-foreground capitalize">{o.status}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>{new Date(o.created_at).toLocaleDateString()}</span>
              <span className="font-semibold">{BRAND.currency}{Number(o.total).toFixed(2)}</span>
            </div>
            {o.items && <div className="text-xs text-muted-foreground line-clamp-1">{o.items.map((i:any)=>i.name).join(", ")}</div>}
          </li>
        ))}
        {orders.length === 0 && <li className="text-center text-sm text-muted-foreground py-12">No orders yet.</li>}
      </ul>
    </div>
  );
}
`;

const profilePage = `import { Link } from "react-router-dom";
import { LogOut, MapPin, Package, ShieldCheck, User as UserIcon } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { BRAND } from "@/lib/brand";

export default function Profile() {
  const { user, isAdmin } = useAuth();

  if (!user) return (
    <div className="min-h-[70dvh] flex flex-col items-center justify-center gap-3 px-6 text-center">
      <UserIcon className="h-10 w-10 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Sign in to manage your profile.</p>
      <Link to="/auth" className="h-11 px-6 rounded-2xl bg-primary text-primary-foreground font-medium grid place-items-center">Sign in</Link>
    </div>
  );

  return (
    <div className="pb-8">
      <header className="px-4 pt-8 pb-6 bg-gradient-to-br from-primary/10 to-accent/10">
        <div className="flex items-center gap-3">
          <div className="h-14 w-14 rounded-full bg-primary text-primary-foreground grid place-items-center text-lg font-bold">{(user.email || "U").slice(0,1).toUpperCase()}</div>
          <div>
            <div className="font-semibold">{user.user_metadata?.display_name || user.email}</div>
            <div className="text-xs text-muted-foreground">{user.email}</div>
          </div>
        </div>
      </header>
      <ul className="p-4 space-y-2">
        <li><Link to="/orders" className="flex items-center gap-3 h-12 px-4 rounded-2xl bg-card border border-border active:scale-[0.98]"><Package className="h-4 w-4" /> My orders</Link></li>
        <li><button className="w-full flex items-center gap-3 h-12 px-4 rounded-2xl bg-card border border-border active:scale-[0.98]"><MapPin className="h-4 w-4" /> Addresses</button></li>
        {isAdmin && <li><Link to="/admin" className="flex items-center gap-3 h-12 px-4 rounded-2xl bg-primary/10 text-primary border border-primary/20 active:scale-[0.98]"><ShieldCheck className="h-4 w-4" /> Admin panel</Link></li>}
        <li><button onClick={() => supabase?.auth.signOut()} className="w-full flex items-center gap-3 h-12 px-4 rounded-2xl text-destructive active:scale-[0.98]"><LogOut className="h-4 w-4" /> Sign out</button></li>
      </ul>
      <div className="px-4 mt-6 text-center text-xs text-muted-foreground">{BRAND.name} · {BRAND.supportEmail}</div>
    </div>
  );
}
`;

const authPage = `import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase, hasSupabase } from "@/lib/supabase";
import { BRAND } from "@/lib/brand";

export default function Auth() {
  const nav = useNavigate();
  const [mode, setMode] = useState<"signin"|"signup">("signin");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string|null>(null);
  const [loading, setLoading] = useState(false);

  if (!hasSupabase) return (
    <div className="min-h-[100dvh] grid place-items-center p-6 text-center">
      <div className="space-y-3 max-w-sm">
        <h1 className="text-xl font-bold">Backend not connected</h1>
        <p className="text-sm text-muted-foreground">Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your <code>.env</code> file, then run the SQL migration in <code>supabase/migrations/0001_init.sql</code> on your Supabase project.</p>
      </div>
    </div>
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null); setLoading(true);
    if (mode === "signup") {
      const { error } = await supabase!.auth.signUp({
        email, password,
        options: { data: { display_name: name }, emailRedirectTo: window.location.origin },
      });
      if (error) setError(error.message); else nav("/");
    } else {
      const { error } = await supabase!.auth.signInWithPassword({ email, password });
      if (error) setError(error.message); else nav("/");
    }
    setLoading(false);
  };

  const google = async () => { await supabase!.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } }); };

  return (
    <div className="min-h-[100dvh] grid place-items-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">{BRAND.name}</h1>
          <p className="text-sm text-muted-foreground">{mode === "signin" ? "Welcome back" : "Create your account"}</p>
        </div>
        {mode === "signup" && (
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name"
            className="h-12 w-full rounded-xl bg-muted px-4 text-sm outline-none focus:ring-2 ring-primary" />
        )}
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" required
          className="h-12 w-full rounded-xl bg-muted px-4 text-sm outline-none focus:ring-2 ring-primary" />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" required minLength={6}
          className="h-12 w-full rounded-xl bg-muted px-4 text-sm outline-none focus:ring-2 ring-primary" />
        {error && <div className="text-sm text-destructive">{error}</div>}
        <button disabled={loading} className="h-12 w-full rounded-xl bg-primary text-primary-foreground font-semibold active:scale-[0.97] disabled:opacity-50">
          {loading ? "Please wait…" : mode === "signin" ? "Sign in" : "Sign up"}
        </button>
        <button type="button" onClick={google} className="h-12 w-full rounded-xl border border-border font-medium active:scale-[0.97]">Continue with Google</button>
        <button type="button" onClick={() => setMode(mode === "signin" ? "signup" : "signin")} className="text-xs text-muted-foreground w-full text-center">
          {mode === "signin" ? "No account? Sign up" : "Have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}
`;

const adminLayout = `import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { LayoutDashboard, Package, ClipboardList, Users, ArrowLeft } from "lucide-react";

export default function AdminLayout() {
  const { user, isAdmin, loading } = useAuth();
  const nav = useNavigate();
  useEffect(() => { if (!loading && (!user || !isAdmin)) nav("/"); }, [user, isAdmin, loading, nav]);
  if (loading) return <div className="p-8 text-center text-muted-foreground">Loading…</div>;
  if (!isAdmin) return null;

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <header className="sticky top-0 z-30 bg-background/90 backdrop-blur border-b border-border px-4 py-3 flex items-center gap-3">
        <button onClick={() => nav("/")} className="h-9 w-9 rounded-full bg-muted grid place-items-center"><ArrowLeft className="h-4 w-4" /></button>
        <h1 className="text-base font-bold">Admin Panel</h1>
      </header>
      <main className="flex-1 overflow-y-auto pb-20"><Outlet /></main>
      <nav className="fixed bottom-0 inset-x-0 bg-background border-t border-border grid grid-cols-4 h-16">
        {[
          { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
          { to: "/admin/products", label: "Products", icon: Package },
          { to: "/admin/orders", label: "Orders", icon: ClipboardList },
          { to: "/admin/users", label: "Users", icon: Users },
        ].map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end as any}
            className={({ isActive }) => \`flex flex-col items-center justify-center gap-1 text-[11px] \${isActive ? "text-primary" : "text-muted-foreground"}\`}>
            <t.icon className="h-5 w-5" /><span>{t.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
`;

const adminDashboard = `import { useEffect, useState } from "react";
import { listAllOrders } from "@/lib/repo/orders";
import { listProducts } from "@/lib/repo/products";
import { BRAND } from "@/lib/brand";

export default function AdminDashboard() {
  const [stats, setStats] = useState({ products: 0, orders: 0, revenue: 0, pending: 0 });
  useEffect(() => {
    (async () => {
      const [orders, products] = await Promise.all([listAllOrders(), listProducts()]);
      setStats({
        products: products.length,
        orders: orders.length,
        revenue: orders.reduce((s, o) => s + Number(o.total), 0),
        pending: orders.filter((o) => o.status === "pending").length,
      });
    })();
  }, []);
  const cards = [
    { label: "Products", value: stats.products },
    { label: "Total orders", value: stats.orders },
    { label: "Revenue", value: \`\${BRAND.currency}\${stats.revenue.toFixed(2)}\` },
    { label: "Pending", value: stats.pending },
  ];
  return (
    <div className="p-4 grid grid-cols-2 gap-3">
      {cards.map((c) => (
        <div key={c.label} className="rounded-2xl border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground">{c.label}</div>
          <div className="text-2xl font-bold mt-1">{c.value}</div>
        </div>
      ))}
    </div>
  );
}
`;

const adminProducts = `import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, Pencil, Upload } from "lucide-react";
import { supabase, hasSupabase } from "@/lib/supabase";
import type { Product } from "@/types";
import { listProducts } from "@/lib/repo/products";
import { BRAND } from "@/lib/brand";

type FormState = { id?: string; name: string; price: string; image_url: string; description: string; stock: string };
const empty: FormState = { name: "", price: "", image_url: "", description: "", stock: "10" };

export default function AdminProducts() {
  const [items, setItems] = useState<Product[]>([]);
  const [form, setForm] = useState<FormState>(empty);
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => listProducts().then(setItems);
  useEffect(() => { refresh(); }, []);

  const upload = async (file: File) => {
    if (!supabase) return;
    setUploading(true);
    try {
      const path = \`\${Date.now()}-\${file.name.replace(/[^a-z0-9.-]/gi, "_")}\`;
      const { error } = await supabase.storage.from("product-images").upload(path, file, { upsert: false });
      if (error) { alert(error.message); return; }
      const { data } = supabase.storage.from("product-images").getPublicUrl(path);
      setForm((f) => ({ ...f, image_url: data.publicUrl }));
    } finally { setUploading(false); }
  };

  const save = async () => {
    if (!supabase) return;
    const payload = {
      name: form.name,
      slug: form.name.toLowerCase().replace(/\\s+/g, "-"),
      price: Number(form.price) || 0,
      image_url: form.image_url,
      description: form.description,
      stock: Number(form.stock) || 0,
      gallery: form.image_url ? [form.image_url] : [],
    };
    if (form.id) await supabase.from("products").update(payload).eq("id", form.id);
    else await supabase.from("products").insert(payload);
    setForm(empty); setOpen(false); refresh();
  };

  const edit = (p: Product) => {
    setForm({ id: p.id, name: p.name, price: String(p.price), image_url: p.image_url ?? "", description: p.description ?? "", stock: String(p.stock) });
    setOpen(true);
  };

  const del = async (id: string) => {
    if (!supabase) return;
    if (!confirm("Delete this product?")) return;
    await supabase.from("products").delete().eq("id", id); refresh();
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Products ({items.length})</h2>
        <button onClick={() => { setForm(empty); setOpen(true); }} className="h-9 px-3 rounded-full bg-primary text-primary-foreground text-xs flex items-center gap-1 active:scale-95">
          <Plus className="h-4 w-4" /> New
        </button>
      </div>
      {!hasSupabase && <div className="rounded-xl bg-muted text-xs p-3 text-muted-foreground">Connect Supabase to manage real products.</div>}
      <ul className="space-y-2">
        {items.map((p) => (
          <li key={p.id} className="flex items-center gap-3 p-2 rounded-xl bg-card border border-border">
            <img src={p.image_url ?? ""} alt={p.name} className="h-12 w-12 rounded-lg object-cover bg-muted" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium line-clamp-1">{p.name}</div>
              <div className="text-xs text-muted-foreground">{BRAND.currency}{Number(p.price).toFixed(2)} · stock {p.stock}</div>
            </div>
            {hasSupabase && (
              <>
                <button onClick={() => edit(p)} className="h-8 w-8 grid place-items-center active:scale-90"><Pencil className="h-4 w-4" /></button>
                <button onClick={() => del(p.id)} className="h-8 w-8 grid place-items-center text-destructive active:scale-90"><Trash2 className="h-4 w-4" /></button>
              </>
            )}
          </li>
        ))}
      </ul>
      {open && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur grid place-items-center p-4">
          <div className="w-full max-w-sm rounded-2xl bg-card border border-border p-4 space-y-3">
            <h3 className="font-semibold">{form.id ? "Edit product" : "New product"}</h3>
            <div className="flex items-center gap-3">
              <div className="h-16 w-16 rounded-xl bg-muted overflow-hidden grid place-items-center">
                {form.image_url ? <img src={form.image_url} alt="" className="h-full w-full object-cover" /> : <Upload className="h-5 w-5 text-muted-foreground" />}
              </div>
              <div className="flex-1 space-y-2">
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
                <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="h-9 px-3 rounded-xl bg-muted text-xs active:scale-95 disabled:opacity-50">
                  {uploading ? "Uploading…" : form.image_url ? "Replace image" : "Upload image"}
                </button>
                <input placeholder="…or paste image URL" value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })}
                  className="h-9 w-full rounded-xl bg-muted px-3 text-xs outline-none" />
              </div>
            </div>
            {[["name","Name"],["price","Price"],["stock","Stock"]].map(([k,l]) => (
              <input key={k} placeholder={l} value={(form as any)[k]} onChange={(e)=>setForm({...form,[k as keyof FormState]:e.target.value})}
                className="h-11 w-full rounded-xl bg-muted px-3 text-sm outline-none" />
            ))}
            <textarea placeholder="Description" value={form.description} onChange={(e)=>setForm({...form,description:e.target.value})}
              className="w-full rounded-xl bg-muted px-3 py-2 text-sm outline-none min-h-[80px]" />
            <div className="flex gap-2">
              <button onClick={() => { setOpen(false); setForm(empty); }} className="flex-1 h-10 rounded-xl bg-muted">Cancel</button>
              <button onClick={save} className="flex-1 h-10 rounded-xl bg-primary text-primary-foreground font-semibold">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
`;

const adminUsers = `import { useEffect, useState } from "react";
import { supabase, hasSupabase } from "@/lib/supabase";

type Row = { user_id: string; display_name: string | null; role: string };

export default function AdminUsers() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!supabase) { setLoading(false); return; }
      const { data: profiles } = await supabase.from("profiles").select("user_id, display_name");
      const { data: roles } = await supabase.from("user_roles").select("user_id, role");
      const byId = new Map<string, string>();
      (roles ?? []).forEach((r: any) => byId.set(r.user_id, r.role));
      setRows((profiles ?? []).map((p: any) => ({ user_id: p.user_id, display_name: p.display_name, role: byId.get(p.user_id) || "customer" })));
      setLoading(false);
    })();
  }, []);

  return (
    <div className="p-4 space-y-3">
      <h2 className="font-semibold">Users ({rows.length})</h2>
      {!hasSupabase && <div className="rounded-xl bg-muted text-xs p-3 text-muted-foreground">Connect Supabase to view users.</div>}
      {loading ? <div className="text-sm text-muted-foreground">Loading…</div> : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.user_id} className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border">
              <div className="h-9 w-9 rounded-full bg-primary text-primary-foreground grid place-items-center text-sm font-bold">
                {(r.display_name || "U").slice(0,1).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium line-clamp-1">{r.display_name || "Unnamed"}</div>
                <div className="text-[11px] text-muted-foreground font-mono line-clamp-1">{r.user_id.slice(0,8)}…</div>
              </div>
              <span className={\`text-[10px] px-2 py-0.5 rounded-full \${r.role === "admin" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}\`}>{r.role}</span>
            </li>
          ))}
          {rows.length === 0 && <li className="text-center text-sm text-muted-foreground py-8">No users yet.</li>}
        </ul>
      )}
    </div>
  );
}
`;

const adminOrders = `import { useEffect, useState } from "react";
import { supabase, hasSupabase } from "@/lib/supabase";
import { listAllOrders } from "@/lib/repo/orders";
import type { Order } from "@/types";
import { BRAND } from "@/lib/brand";

const STATUSES = ["pending","paid","shipped","delivered","cancelled"];

export default function AdminOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const refresh = () => listAllOrders().then(setOrders);
  useEffect(() => { refresh(); }, []);

  const setStatus = async (id: string, status: string) => {
    if (!supabase) return;
    await supabase.from("orders").update({ status }).eq("id", id); refresh();
  };

  return (
    <div className="p-4 space-y-3">
      <h2 className="font-semibold">All orders ({orders.length})</h2>
      {!hasSupabase && <div className="rounded-xl bg-muted text-xs p-3 text-muted-foreground">Connect Supabase to manage real orders.</div>}
      <ul className="space-y-2">
        {orders.map((o) => (
          <li key={o.id} className="rounded-2xl border border-border bg-card p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">#{o.id.slice(0,8)}</span>
              <span className="text-sm font-semibold">{BRAND.currency}{Number(o.total).toFixed(2)}</span>
            </div>
            <div className="text-xs text-muted-foreground">{new Date(o.created_at).toLocaleString()}</div>
            <select value={o.status} onChange={(e) => setStatus(o.id, e.target.value)}
              className="h-9 w-full rounded-lg bg-muted text-sm px-2 outline-none">
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </li>
        ))}
        {orders.length === 0 && <li className="text-center text-sm text-muted-foreground py-8">No orders.</li>}
      </ul>
    </div>
  );
}
`;

const readme = `# __APP_NAME__

A complete mobile-first shopping app scaffolded by the AI agent.

## Quick start

\`\`\`bash
npm install
npm run dev
\`\`\`

## Connect your backend (required for real auth + orders)

1. Open \`.env\` and paste your Supabase project URL + anon key:
   \`\`\`
   VITE_SUPABASE_URL=https://YOUR.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   \`\`\`
2. Run the SQL migration in \`supabase/migrations/0001_init.sql\` on your Supabase SQL editor.
3. Promote yourself to admin: \`insert into user_roles (user_id, role) values ('<your-uuid>', 'admin');\`

Until step 1 is done the app runs on seeded demo data.

## Customize

- \`src/lib/brand.ts\` — name, tagline, currency, support email
- \`src/lib/seed.ts\` — demo categories & products (before backend is connected)
- \`src/index.css\` — theme colors (HSL semantic tokens)

The agent is instructed to only touch these slots when re-skinning.
`;

export const ECOMMERCE_PAGE_FILES: ScaffoldFile[] = [
  { path: "src/main.tsx", content: mainTsx },
  { path: "src/App.tsx", content: appTsx },
  { path: "src/components/mobile/BottomNav.tsx", content: bottomNav },
  { path: "src/components/product/ProductCard.tsx", content: productCard },
  { path: "src/pages/Home.tsx", content: homePage },
  { path: "src/pages/Category.tsx", content: categoryPage },
  { path: "src/pages/Product.tsx", content: productPage },
  { path: "src/pages/Cart.tsx", content: cartPage },
  { path: "src/pages/Checkout.tsx", content: checkoutPage },
  { path: "src/pages/Orders.tsx", content: ordersPage },
  { path: "src/pages/Profile.tsx", content: profilePage },
  { path: "src/pages/Auth.tsx", content: authPage },
  { path: "src/pages/admin/AdminLayout.tsx", content: adminLayout },
  { path: "src/pages/admin/AdminDashboard.tsx", content: adminDashboard },
  { path: "src/pages/admin/AdminProducts.tsx", content: adminProducts },
  { path: "src/pages/admin/AdminOrders.tsx", content: adminOrders },
  { path: "src/pages/admin/AdminUsers.tsx", content: adminUsers },
  { path: "README.md", content: readme },
];
