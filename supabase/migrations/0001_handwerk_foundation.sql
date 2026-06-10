-- 0001_handwerk_foundation.sql — Valooro Handwerk DB-Fundament (MVP)
-- ANWENDUNG: manuell über Supabase-Dashboard (SQL Editor) im EIGENEN Handwerk-Projekt.
-- ISOLATION: eigenes Supabase-Projekt (kein geteiltes Schema mit Hotel).

-- 1. updated_at-Helper (SECURITY INVOKER = Default, keine erhöhten Rechte)
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 2. Tabellen
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  business_email text unique not null,
  slug text unique,
  status text not null default 'active' check (status in ('active','suspended')),
  default_language text not null default 'de',
  branding jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  consent_text text,
  retention_months integer not null default 12 check (retention_months between 1 and 120),
  stripe_customer_id text,
  webhook_secret text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.business_users (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','staff')),
  created_at timestamptz not null default now(),
  unique (business_id, user_id)
);
create index idx_business_users_user on public.business_users(user_id);
create index idx_business_users_business on public.business_users(business_id);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_name text not null,
  customer_email text,
  customer_phone text,
  external_ref text,
  item_description text,
  language text not null default 'de',
  status text not null default 'draft'
    check (status in ('draft','finalized','generated','sent','viewed','shared')),
  consent_given boolean not null default false,
  consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_orders_business_status on public.orders(business_id, status);
create index idx_orders_business_extref on public.orders(business_id, external_ref);

create table public.order_media (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  media_type text not null check (media_type in ('photo','video')),
  storage_path text not null,
  keyword text,
  tag text check (tag in ('vorher','nachher','prozess')),
  caption text,
  sort_order integer not null default 0,
  duration_seconds numeric,
  width integer,
  height integer,
  created_at timestamptz not null default now()
);
create index idx_order_media_order on public.order_media(order_id, sort_order);
create index idx_order_media_business on public.order_media(business_id);

create table public.booklets (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  access_token text not null unique,           -- app-generiert, unerratbar (>= 24 Byte base64url)
  intro_title text,
  intro_description text,
  review_draft text,
  ig_caption text,
  web_story_ready boolean not null default false,
  reel_url text,
  image_urls jsonb,
  language text not null default 'de',
  sent_at timestamptz,
  viewed_at timestamptz,
  first_shared_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_booklets_business on public.booklets(business_id);

create table public.billing_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  booklet_id uuid references public.booklets(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  event_type text not null check (event_type in ('booklet_sent')),
  created_at timestamptz not null default now()
);
create index idx_billing_events_business on public.billing_events(business_id, created_at);

create table public.booklet_events (
  id uuid primary key default gen_random_uuid(),
  booklet_id uuid not null references public.booklets(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  event_type text not null check (event_type in ('viewed','shared','qr_click','link_click')),
  channel text,
  ip_hash text,
  created_at timestamptz not null default now()
);
create index idx_booklet_events_booklet on public.booklet_events(booklet_id, event_type);

-- 3. updated_at-Trigger
create trigger trg_businesses_updated before update on public.businesses
  for each row execute function public.set_updated_at();
create trigger trg_orders_updated before update on public.orders
  for each row execute function public.set_updated_at();
create trigger trg_booklets_updated before update on public.booklets
  for each row execute function public.set_updated_at();

-- 4. RLS aktivieren (ALLE Tabellen)
alter table public.businesses     enable row level security;
alter table public.business_users enable row level security;
alter table public.orders         enable row level security;
alter table public.order_media    enable row level security;
alter table public.booklets       enable row level security;
alter table public.billing_events enable row level security;
alter table public.booklet_events enable row level security;

-- 5. Policies (authenticated = Betriebs-Mitglieder; Mitgliedschaft INLINE, keine SECURITY-DEFINER-Funktion)
create policy businesses_select on public.businesses for select to authenticated
  using (exists (select 1 from public.business_users bu where bu.business_id = businesses.id and bu.user_id = auth.uid()));
create policy businesses_update on public.businesses for update to authenticated
  using (exists (select 1 from public.business_users bu where bu.business_id = businesses.id and bu.user_id = auth.uid()));

create policy business_users_select on public.business_users for select to authenticated
  using (user_id = auth.uid());

create policy orders_all on public.orders for all to authenticated
  using (exists (select 1 from public.business_users bu where bu.business_id = orders.business_id and bu.user_id = auth.uid()))
  with check (exists (select 1 from public.business_users bu where bu.business_id = orders.business_id and bu.user_id = auth.uid()));

create policy order_media_all on public.order_media for all to authenticated
  using (exists (select 1 from public.business_users bu where bu.business_id = order_media.business_id and bu.user_id = auth.uid()))
  with check (exists (select 1 from public.business_users bu where bu.business_id = order_media.business_id and bu.user_id = auth.uid()));

create policy booklets_select on public.booklets for select to authenticated
  using (exists (select 1 from public.business_users bu where bu.business_id = booklets.business_id and bu.user_id = auth.uid()));
create policy booklets_update on public.booklets for update to authenticated
  using (exists (select 1 from public.business_users bu where bu.business_id = booklets.business_id and bu.user_id = auth.uid()));

create policy billing_events_select on public.billing_events for select to authenticated
  using (exists (select 1 from public.business_users bu where bu.business_id = billing_events.business_id and bu.user_id = auth.uid()));

create policy booklet_events_select on public.booklet_events for select to authenticated
  using (exists (select 1 from public.business_users bu where bu.business_id = booklet_events.business_id and bu.user_id = auth.uid()));

-- 6. Defensiv: etwaige Default-Privilegien für anon/PUBLIC entfernen (Supabase grantet per Default an anon!)
revoke all on public.businesses, public.business_users, public.orders, public.order_media,
              public.booklets, public.billing_events, public.booklet_events from anon;
revoke all on public.businesses, public.business_users, public.orders, public.order_media,
              public.booklets, public.billing_events, public.booklet_events from public;

-- 7. Explizite GRANTs (KEIN anon, KEIN PUBLIC)
grant select, insert, update, delete on public.orders to authenticated;
grant select, insert, update, delete on public.order_media to authenticated;
grant select, update on public.businesses to authenticated;
grant select on public.business_users to authenticated;
grant select, update on public.booklets to authenticated;
grant select on public.billing_events to authenticated;
grant select on public.booklet_events to authenticated;

grant all on public.businesses, public.business_users, public.orders, public.order_media,
             public.booklets, public.billing_events, public.booklet_events to service_role;

-- anon: KEINE Grants. Öffentliche Booklet-Reads laufen ausschliesslich über service_role-API + server-seitige Token-Validierung.

-- REGEL (jetzt keine solche Funktion vorhanden): jede künftige SECURITY-DEFINER-Funktion MUSS
--   `revoke execute on function <fn> from public;` + gezielten grant erhalten.
