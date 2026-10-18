// SQL migration that bootstraps the connected Supabase project for a
// shopping app: products, categories, orders, order_items, profiles,
// user_roles + RLS policies. Runs once when the user provides their
// Supabase credentials in the generated app.

export const ECOMMERCE_SQL = `-- ============================================
-- E-COMMERCE SCAFFOLD MIGRATION
-- ============================================

-- Role enum + has_role helper (avoids recursive RLS).
do $$ begin
  create type public.app_role as enum ('admin', 'customer');
exception when duplicate_object then null; end $$;

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null default 'customer',
  unique (user_id, role)
);
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role);
$$;

-- Profiles
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  phone text,
  address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- Categories
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  image_url text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.categories enable row level security;

-- Products
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text not null default '',
  price numeric(10,2) not null,
  compare_price numeric(10,2),
  image_url text,
  gallery jsonb not null default '[]'::jsonb,
  category_id uuid references public.categories(id) on delete set null,
  stock int not null default 0,
  rating numeric(2,1) not null default 4.5,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.products enable row level security;

-- Orders
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending', -- pending | paid | shipped | delivered | cancelled
  subtotal numeric(10,2) not null default 0,
  shipping numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  shipping_address jsonb not null default '{}'::jsonb,
  payment_method text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.orders enable row level security;

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  name text not null,
  price numeric(10,2) not null,
  quantity int not null default 1,
  image_url text
);
alter table public.order_items enable row level security;

-- Cart items (persisted per user, replaces localStorage cart)
create table if not exists public.cart_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, product_id)
);
alter table public.cart_items enable row level security;
drop policy if exists "users manage own cart" on public.cart_items;
create policy "users manage own cart" on public.cart_items for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ===== RLS =====
drop policy if exists "anyone reads categories" on public.categories;
create policy "anyone reads categories" on public.categories for select using (true);
drop policy if exists "admins write categories" on public.categories;
create policy "admins write categories" on public.categories for all using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "anyone reads products" on public.products;
create policy "anyone reads products" on public.products for select using (is_active = true or public.has_role(auth.uid(), 'admin'));
drop policy if exists "admins write products" on public.products;
create policy "admins write products" on public.products for all using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "users view own profile" on public.profiles;
create policy "users view own profile" on public.profiles for select using (auth.uid() = user_id or public.has_role(auth.uid(), 'admin'));
drop policy if exists "users upsert own profile" on public.profiles;
create policy "users upsert own profile" on public.profiles for insert with check (auth.uid() = user_id);
drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile" on public.profiles for update using (auth.uid() = user_id);

drop policy if exists "users view own orders" on public.orders;
create policy "users view own orders" on public.orders for select using (auth.uid() = user_id or public.has_role(auth.uid(), 'admin'));
drop policy if exists "users create own orders" on public.orders;
create policy "users create own orders" on public.orders for insert with check (auth.uid() = user_id);
drop policy if exists "admins update orders" on public.orders;
create policy "admins update orders" on public.orders for update using (public.has_role(auth.uid(), 'admin'));

drop policy if exists "users view own order items" on public.order_items;
create policy "users view own order items" on public.order_items for select using (
  exists (select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or public.has_role(auth.uid(), 'admin')))
);
drop policy if exists "users insert own order items" on public.order_items;
create policy "users insert own order items" on public.order_items for insert with check (
  exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid())
);

drop policy if exists "users view own roles" on public.user_roles;
create policy "users view own roles" on public.user_roles for select using (auth.uid() = user_id or public.has_role(auth.uid(), 'admin'));
drop policy if exists "admins manage roles" on public.user_roles;
create policy "admins manage roles" on public.user_roles for all using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

-- Auto-create profile + role on signup. First user becomes admin, rest are customers.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_first boolean;
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (user_id) do nothing;
  select not exists (select 1 from public.user_roles) into is_first;
  insert into public.user_roles (user_id, role)
  values (new.id, case when is_first then 'admin'::public.app_role else 'customer'::public.app_role end)
  on conflict (user_id, role) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Storage bucket for product images (public read, admin write)
insert into storage.buckets (id, name, public)
  values ('product-images', 'product-images', true)
  on conflict (id) do nothing;

drop policy if exists "public read product images" on storage.objects;
create policy "public read product images" on storage.objects for select
  using (bucket_id = 'product-images');
drop policy if exists "admins upload product images" on storage.objects;
create policy "admins upload product images" on storage.objects for insert
  with check (bucket_id = 'product-images' and public.has_role(auth.uid(), 'admin'));
drop policy if exists "admins update product images" on storage.objects;
create policy "admins update product images" on storage.objects for update
  using (bucket_id = 'product-images' and public.has_role(auth.uid(), 'admin'));
drop policy if exists "admins delete product images" on storage.objects;
create policy "admins delete product images" on storage.objects for delete
  using (bucket_id = 'product-images' and public.has_role(auth.uid(), 'admin'));
`;
