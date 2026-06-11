-- Mevcut veritabanları için: PayTR sipariş takip tablosu.
-- PayTR merchant_oid yalnızca alfanümerik karakter kabul ettiği için sipariş
-- bilgileri (workspace/paket/kupon) artık oid içine gömülmüyor; bu tabloda tutuluyor.
-- Supabase SQL Editor'de bir kez çalıştırın.

create table if not exists public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  merchant_oid text not null unique,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  package_id uuid not null references public.packages(id) on delete restrict,
  coupon_code text,
  amount_kurus integer not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed')),
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists payment_orders_workspace_idx on public.payment_orders(workspace_id);

-- Bilinçli olarak hiçbir policy tanımlanmıyor: tabloya yalnızca service role erişir.
alter table public.payment_orders enable row level security;
