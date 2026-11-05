-- 個人預購管理 App：資料庫結構
-- 在 Supabase 的 SQL Editor 貼上整份執行。可以重複執行，不會清掉既有資料。
--
-- 安全設計重點：
-- 1. 所有資料表都啟用 Row Level Security，而且不開放任何直接存取。
-- 2. 顧客與管理員都只能呼叫下方的函式，顧客的函式不會回傳任何訂單資料。
-- 3. 管理函式一律先檢查登入者是否在 admins 名單內。

-- ---------------------------------------------------------------------------
-- 資料表
-- ---------------------------------------------------------------------------

create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.shop_settings (
  id           int primary key default 1 check (id = 1),
  shop_name    text not null default '我的預購小舖',
  shipping_fee int  not null default 38 check (shipping_fee >= 0),
  notice       text not null default '預購商品恕不接受無故取消。商品到貨後會以 7-ELEVEN 賣貨便寄出，到店取貨時付款。',
  updated_at   timestamptz not null default now()
);
insert into public.shop_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.products (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
  name          text not null default '',
  description   text not null default '',
  status        text not null default 'draft' check (status in ('draft', 'published', 'hidden')),
  starts_at     timestamptz,
  ends_at       timestamptz,
  ship_estimate text not null default '',
  notice        text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.product_images (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  path       text not null,
  position   int  not null default 0
);
create index if not exists product_images_product_idx on public.product_images (product_id, position);

create table if not exists public.product_variants (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  label      text not null,
  price      int  not null check (price >= 0),
  qty_limit  int  check (qty_limit is null or qty_limit >= 0), -- 空白代表不限數量
  position   int  not null default 0,
  archived   boolean not null default false                    -- 已有訂單的規格刪除時改為封存
);
create index if not exists product_variants_product_idx on public.product_variants (product_id, position);

create table if not exists public.orders (
  id                  uuid primary key default gen_random_uuid(),
  order_no            text not null unique,
  status              text not null default 'new'
                      check (status in ('new', 'confirmed', 'closed', 'processing', 'shipped', 'completed', 'cancelled')),
  customer_name       text not null,
  customer_phone      text not null,
  pickup_store        text not null,
  note                text not null default '',
  items_total         int  not null,
  shipping_fee        int  not null,
  total               int  not null,
  client_token        uuid not null unique,  -- 防止重複送出
  privacy_accepted_at timestamptz not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists orders_created_idx on public.orders (created_at desc);
create index if not exists orders_status_idx on public.orders (status);

-- 訂單明細保存下單當下的商品資料，之後修改或刪除商品都不會影響。
create table if not exists public.order_items (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders (id) on delete cascade,
  product_id    uuid references public.products (id) on delete set null,
  variant_id    uuid references public.product_variants (id) on delete set null,
  product_name  text not null,
  variant_label text not null,
  unit_price    int  not null,
  qty           int  not null check (qty > 0),
  line_total    int  not null
);
create index if not exists order_items_order_idx on public.order_items (order_id);
create index if not exists order_items_variant_idx on public.order_items (variant_id);
create index if not exists order_items_product_idx on public.order_items (product_id);

-- 下單頻率限制用，只存雜湊值，保留一天後清除。
create table if not exists public.order_throttle (
  id         bigint generated always as identity primary key,
  key_hash   text not null,
  created_at timestamptz not null default now()
);
create index if not exists order_throttle_idx on public.order_throttle (key_hash, created_at);

-- 到貨通知：顧客留 Email，到貨後由賣家寄出賣貨便賣場連結，顧客在賣貨便選門市並完成下單。
alter table public.orders   add column if not exists customer_email text not null default '';
alter table public.orders   add column if not exists arrival_notified_at timestamptz;
alter table public.orders   alter column pickup_store set default '';
alter table public.products add column if not exists myship_url text not null default '';

-- 商店品牌資訊
alter table public.shop_settings add column if not exists tagline text not null default '';
alter table public.shop_settings add column if not exists contact text not null default '';

-- 全部啟用 RLS，且刻意不建立任何 policy：直接讀寫資料表一律被拒絕。
alter table public.admins           enable row level security;
alter table public.shop_settings    enable row level security;
alter table public.products         enable row level security;
alter table public.product_images   enable row level security;
alter table public.product_variants enable row level security;
alter table public.orders           enable row level security;
alter table public.order_items      enable row level security;
alter table public.order_throttle   enable row level security;

revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 內部輔助函式
-- ---------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;

create or replace function public.require_admin()
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception '需要管理員權限' using errcode = '42501';
  end if;
end;
$$;

-- 規格目前的有效預購數量。取消的訂單不計入，因此取消後名額會自動釋出。
create or replace function public.variant_ordered_qty(p_variant_id uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(i.qty), 0)::int
  from public.order_items i
  join public.orders o on o.id = i.order_id
  where i.variant_id = p_variant_id and o.status <> 'cancelled';
$$;

create or replace function public.image_list(p_product_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'path', i.path) order by i.position), '[]'::jsonb)
  from public.product_images i
  where i.product_id = p_product_id;
$$;

create or replace function public.product_phase(p_starts timestamptz, p_ends timestamptz)
returns text
language sql stable set search_path = ''
as $$
  select case
    when p_starts is not null and now() < p_starts then 'upcoming'
    when p_ends is null or now() >= p_ends then 'ended'
    else 'open'
  end;
$$;

-- ---------------------------------------------------------------------------
-- 顧客可呼叫的函式
-- ---------------------------------------------------------------------------

create or replace function public.get_shop_info()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'shop_name', s.shop_name,
    'tagline', s.tagline,
    'contact', s.contact,
    'shipping_fee', s.shipping_fee,
    'notice', s.notice,
    'server_now', now()
  )
  from public.shop_settings s
  where s.id = 1;
$$;

create or replace function public.list_public_products()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(row_data order by sort_at desc), '[]'::jsonb)
  from (
    select
      p.created_at as sort_at,
      jsonb_build_object(
        'slug', p.slug,
        'name', p.name,
        'starts_at', p.starts_at,
        'ends_at', p.ends_at,
        'phase', public.product_phase(p.starts_at, p.ends_at),
        'cover', (select i.path from public.product_images i
                  where i.product_id = p.id order by i.position limit 1),
        'min_price', (select min(v.price) from public.product_variants v
                      where v.product_id = p.id and not v.archived),
        'max_price', (select max(v.price) from public.product_variants v
                      where v.product_id = p.id and not v.archived),
        'remaining', (select case when count(*) filter (where v.qty_limit is null) > 0 then null
                                  else coalesce(sum(greatest(v.qty_limit - public.variant_ordered_qty(v.id), 0)), 0)::int end
                      from public.product_variants v
                      where v.product_id = p.id and not v.archived),
        'sold_out', not exists (
          select 1 from public.product_variants v
          where v.product_id = p.id and not v.archived
            and (v.qty_limit is null or v.qty_limit > public.variant_ordered_qty(v.id))
        )
      ) as row_data
    from public.products p
    where p.status = 'published'
  ) t;
$$;

create or replace function public.get_public_product(p_slug text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'slug', p.slug,
    'name', p.name,
    'description', p.description,
    'starts_at', p.starts_at,
    'ends_at', p.ends_at,
    'phase', public.product_phase(p.starts_at, p.ends_at),
    'ship_estimate', p.ship_estimate,
    'notice', p.notice,
    'images', public.image_list(p.id),
    'variants', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', v.id,
        'label', v.label,
        'price', v.price,
        'remaining', case when v.qty_limit is null then null
                          else greatest(v.qty_limit - public.variant_ordered_qty(v.id), 0) end
      ) order by v.position), '[]'::jsonb)
      from public.product_variants v
      where v.product_id = p.id and not v.archived
    ),
    'server_now', now()
  )
  from public.products p
  where p.slug = p_slug and p.status = 'published';
$$;

-- 送出預購單。價格、運費與數量全部以資料庫為準，前端傳來的金額只用來比對。
create or replace function public.submit_preorder(p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_token     uuid;
  v_name      text := btrim(coalesce(p ->> 'customer_name', ''));
  v_phone     text := regexp_replace(coalesce(p ->> 'customer_phone', ''), '[^0-9]', '', 'g');
  v_email     text := lower(btrim(coalesce(p ->> 'customer_email', '')));
  v_note      text := btrim(coalesce(p ->> 'note', ''));
  v_expected  int;
  v_headers   jsonb;
  v_ip        text;
  v_order_id  uuid;
  v_order_no  text;
  v_fee       int;
  v_items     int := 0;
  v_total     int;
  v_existing  public.orders%rowtype;
  v_ordered   int;
  v_lines     jsonb := '[]'::jsonb;
  r           record;
begin
  -- 隱藏欄位：真人看不到，有填內容就是機器人。
  if coalesce(p ->> 'website', '') <> '' then
    raise exception '無法送出預購單' using errcode = 'P0001';
  end if;

  begin
    v_token := (p ->> 'client_token')::uuid;
  exception when invalid_text_representation then
    v_token := null;
  end;
  if v_token is null then
    raise exception '預購單資料不完整，請重新整理後再試一次' using errcode = 'P0001';
  end if;

  -- 同一張預購單重送時，回傳原本的結果，不會重複成立。
  select * into v_existing from public.orders o where o.client_token = v_token;
  if found then
    return public.order_receipt(v_existing.id);
  end if;

  if char_length(v_name) not between 1 and 50 then
    raise exception '請填寫 50 字以內的取貨人姓名' using errcode = 'P0001';
  end if;
  if v_phone !~ '^09[0-9]{8}$' then
    raise exception '手機號碼格式不正確，請填寫 09 開頭的 10 碼號碼' using errcode = 'P0001';
  end if;
  if char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Email 格式不正確，請填寫收得到信的信箱' using errcode = 'P0001';
  end if;
  if char_length(v_note) > 300 then
    raise exception '備註請在 300 字以內' using errcode = 'P0001';
  end if;
  if coalesce((p ->> 'privacy_accepted')::boolean, false) is not true then
    raise exception '請先同意個人資料僅用於處理這筆預購' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p -> 'items') is distinct from 'array'
     or jsonb_array_length(p -> 'items') not between 1 and 30 then
    raise exception '請先選擇要預購的規格' using errcode = 'P0001';
  end if;

  -- 頻率限制：同一手機 10 分鐘 5 筆、同一網路來源 10 分鐘 30 筆。
  delete from public.order_throttle where created_at < now() - interval '1 day';
  if (select count(*) from public.order_throttle t
      where t.key_hash = md5('phone:' || v_phone)
        and t.created_at > now() - interval '10 minutes') >= 5 then
    raise exception '送出次數太多，請 10 分鐘後再試' using errcode = 'P0001', hint = 'rate_limited';
  end if;

  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;
  v_ip := coalesce(
    v_headers ->> 'cf-connecting-ip',
    btrim(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1))
  );
  if coalesce(v_ip, '') <> '' then
    if (select count(*) from public.order_throttle t
        where t.key_hash = md5('ip:' || v_ip)
          and t.created_at > now() - interval '10 minutes') >= 30 then
      raise exception '送出次數太多，請 10 分鐘後再試' using errcode = 'P0001', hint = 'rate_limited';
    end if;
    insert into public.order_throttle (key_hash) values (md5('ip:' || v_ip));
  end if;
  insert into public.order_throttle (key_hash) values (md5('phone:' || v_phone));

  -- 依固定順序鎖定規格列。同時下單會在這裡排隊，所以最後一件只會賣給一個人。
  perform 1
  from public.product_variants v
  where v.id in (select (e ->> 'variant_id')::uuid from jsonb_array_elements(p -> 'items') e)
  order by v.id
  for update;

  for r in
    select
      v.id, v.label, v.price, v.qty_limit, v.archived, v.product_id,
      pr.name as product_name, pr.status as product_status, pr.starts_at, pr.ends_at,
      w.qty
    from (
      select (e ->> 'variant_id')::uuid as variant_id, sum((e ->> 'qty')::int)::int as qty
      from jsonb_array_elements(p -> 'items') e
      group by 1
    ) w
    left join public.product_variants v on v.id = w.variant_id
    left join public.products pr on pr.id = v.product_id
    order by w.variant_id
  loop
    if r.id is null or r.archived or r.product_status is distinct from 'published' then
      raise exception '選擇的商品已下架，請重新整理頁面' using errcode = 'P0001', hint = 'unavailable';
    end if;
    if public.product_phase(r.starts_at, r.ends_at) = 'upcoming' then
      raise exception '「%」尚未開放預購', r.product_name using errcode = 'P0001', hint = 'unavailable';
    end if;
    if public.product_phase(r.starts_at, r.ends_at) = 'ended' then
      raise exception '「%」的預購已結束', r.product_name using errcode = 'P0001', hint = 'unavailable';
    end if;
    if r.qty is null or r.qty < 1 or r.qty > 99 then
      raise exception '每個規格的數量須為 1 到 99 件' using errcode = 'P0001';
    end if;
    if r.qty_limit is not null then
      v_ordered := public.variant_ordered_qty(r.id);
      if v_ordered + r.qty > r.qty_limit then
        raise exception '「%」只剩 % 件，請調整數量',
          r.label, greatest(r.qty_limit - v_ordered, 0)
          using errcode = 'P0001', hint = 'sold_out';
      end if;
    end if;

    v_items := v_items + r.price * r.qty;
    v_lines := v_lines || jsonb_build_object(
      'product_id', r.product_id, 'variant_id', r.id,
      'product_name', r.product_name, 'variant_label', r.label,
      'unit_price', r.price, 'qty', r.qty
    );
  end loop;

  -- 同一張預購單同時送出兩次時，第二次會排隊到這裡，因此再檢查一次。
  select * into v_existing from public.orders o where o.client_token = v_token;
  if found then
    return public.order_receipt(v_existing.id);
  end if;

  select s.shipping_fee into v_fee from public.shop_settings s where s.id = 1;
  v_total := v_items + v_fee;

  -- 顧客看到的金額與實際不同時（例如賣家剛改價），不成立訂單。
  v_expected := nullif(p ->> 'expected_total', '')::int;
  if v_expected is not null and v_expected <> v_total then
    raise exception '價格剛剛更新，合計已改為 NT$%，請確認後再送出', v_total
      using errcode = 'P0001', hint = 'price_changed';
  end if;

  v_order_id := gen_random_uuid();
  loop
    v_order_no := to_char(now() at time zone 'Asia/Taipei', 'YYMMDD') || '-'
                  || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (select 1 from public.orders o where o.order_no = v_order_no);
  end loop;

  insert into public.orders (
    id, order_no, customer_name, customer_phone, customer_email, note,
    items_total, shipping_fee, total, client_token, privacy_accepted_at
  ) values (
    v_order_id, v_order_no, v_name, v_phone, v_email, v_note,
    v_items, v_fee, v_total, v_token, now()
  );

  insert into public.order_items (
    order_id, product_id, variant_id, product_name, variant_label, unit_price, qty, line_total
  )
  select
    v_order_id,
    (l ->> 'product_id')::uuid,
    (l ->> 'variant_id')::uuid,
    l ->> 'product_name',
    l ->> 'variant_label',
    (l ->> 'unit_price')::int,
    (l ->> 'qty')::int,
    (l ->> 'unit_price')::int * (l ->> 'qty')::int
  from jsonb_array_elements(v_lines) l;

  return public.order_receipt(v_order_id);
end;
$$;

-- 成功畫面用的收據，刻意不含姓名、電話、門市等個資。
create or replace function public.order_receipt(p_order_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'order_no', o.order_no,
    'items_total', o.items_total,
    'shipping_fee', o.shipping_fee,
    'total', o.total,
    'created_at', o.created_at,
    'items', (
      select jsonb_agg(jsonb_build_object(
        'product_name', i.product_name,
        'variant_label', i.variant_label,
        'unit_price', i.unit_price,
        'qty', i.qty
      ) order by i.product_name, i.variant_label)
      from public.order_items i where i.order_id = o.id
    )
  )
  from public.orders o
  where o.id = p_order_id;
$$;

-- ---------------------------------------------------------------------------
-- 管理員函式
-- ---------------------------------------------------------------------------

create or replace function public.admin_dashboard()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_today_start timestamptz :=
    date_trunc('day', now() at time zone 'Asia/Taipei') at time zone 'Asia/Taipei';
begin
  perform public.require_admin();
  return jsonb_build_object(
    'published_count', (select count(*) from public.products p where p.status = 'published'),
    'open_count', (select count(*) from public.products p
                   where p.status = 'published'
                     and public.product_phase(p.starts_at, p.ends_at) = 'open'),
    'today_orders', (select count(*) from public.orders o where o.created_at >= v_today_start),
    'pending_orders', (select count(*) from public.orders o where o.status = 'new'),
    'stats', public.admin_variant_stats()
  );
end;
$$;

-- 各商品、各規格的預購統計。不含已取消訂單。
create or replace function public.admin_variant_stats()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  return (
    with sold as (
      select
        i.product_id, i.variant_id,
        max(i.product_name) as product_name,
        max(i.variant_label) as variant_label,
        sum(i.qty)::int as qty,
        count(distinct i.order_id)::int as order_count,
        sum(i.line_total)::int as amount
      from public.order_items i
      join public.orders o on o.id = i.order_id
      where o.status <> 'cancelled'
      group by i.product_id, i.variant_id,
        case when i.variant_id is null then i.product_name || E'\n' || i.variant_label end
    ),
    live as (
      select v.id as variant_id, v.product_id, v.label, v.qty_limit, v.position,
             p.name as product_name, p.created_at
      from public.product_variants v
      join public.products p on p.id = v.product_id
      where not v.archived or exists (select 1 from sold s where s.variant_id = v.id)
    ),
    merged as (
      select
        coalesce(l.product_id, s.product_id) as product_id,
        coalesce(l.product_name, s.product_name) as product_name,
        l.variant_id,
        coalesce(l.label, s.variant_label) as variant_label,
        l.qty_limit,
        coalesce(s.qty, 0) as qty,
        coalesce(s.order_count, 0) as order_count,
        coalesce(s.amount, 0) as amount,
        l.position,
        l.created_at
      from live l
      full join sold s on s.variant_id = l.variant_id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'product_id', m.product_id,
      'product_name', m.product_name,
      'variant_id', m.variant_id,
      'variant_label', m.variant_label,
      'qty_limit', m.qty_limit,
      'qty', m.qty,
      'order_count', m.order_count,
      'amount', m.amount
    ) order by m.created_at desc nulls last, m.product_name, m.position nulls last, m.variant_label), '[]'::jsonb)
    from merged m
  );
end;
$$;

create or replace function public.admin_list_products()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'slug', p.slug,
      'name', p.name,
      'status', p.status,
      'phase', public.product_phase(p.starts_at, p.ends_at),
      'starts_at', p.starts_at,
      'ends_at', p.ends_at,
      'cover', (select i.path from public.product_images i
                where i.product_id = p.id order by i.position limit 1),
      'min_price', (select min(v.price) from public.product_variants v
                    where v.product_id = p.id and not v.archived),
      'max_price', (select max(v.price) from public.product_variants v
                    where v.product_id = p.id and not v.archived),
      'variant_count', (select count(*) from public.product_variants v
                        where v.product_id = p.id and not v.archived),
      'ordered_qty', (select coalesce(sum(i.qty), 0) from public.order_items i
                      join public.orders o on o.id = i.order_id
                      where i.product_id = p.id and o.status <> 'cancelled')
    ) order by p.created_at desc), '[]'::jsonb)
    from public.products p
  );
end;
$$;

create or replace function public.admin_get_product(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  return (
    select jsonb_build_object(
      'id', p.id,
      'slug', p.slug,
      'name', p.name,
      'description', p.description,
      'status', p.status,
      'starts_at', p.starts_at,
      'ends_at', p.ends_at,
      'ship_estimate', p.ship_estimate,
      'notice', p.notice,
      'images', public.image_list(p.id),
      'variants', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', v.id,
          'label', v.label,
          'price', v.price,
          'qty_limit', v.qty_limit,
          'ordered', public.variant_ordered_qty(v.id)
        ) order by v.position), '[]'::jsonb)
        from public.product_variants v
        where v.product_id = p.id and not v.archived
      )
    )
    from public.products p
    where p.id = p_id
  );
end;
$$;

-- 一次儲存商品、照片順序與規格，全部成功或全部不變。
create or replace function public.admin_save_product(p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_id        uuid := (p ->> 'id')::uuid;
  v_status    text := coalesce(p ->> 'status', 'draft');
  v_name      text := btrim(coalesce(p ->> 'name', ''));
  v_starts    timestamptz := nullif(p ->> 'starts_at', '')::timestamptz;
  v_ends      timestamptz := nullif(p ->> 'ends_at', '')::timestamptz;
  v_images    jsonb := coalesce(p -> 'images', '[]'::jsonb);
  v_variants  jsonb := coalesce(p -> 'variants', '[]'::jsonb);
  v_removed   jsonb;
  v_keep      uuid[];
  v_slug      text;
  e           jsonb;
  i           int;
begin
  perform public.require_admin();

  if v_id is null then
    raise exception '商品資料不完整' using errcode = 'P0001';
  end if;
  if v_status not in ('draft', 'published', 'hidden') then
    raise exception '商品狀態不正確' using errcode = 'P0001';
  end if;
  if jsonb_array_length(v_images) > 10 then
    raise exception '每個商品最多 10 張照片' using errcode = 'P0001';
  end if;

  for i in 0 .. jsonb_array_length(v_variants) - 1 loop
    e := v_variants -> i;
    if btrim(coalesce(e ->> 'label', '')) = '' then
      raise exception '請填寫第 % 個規格的名稱', i + 1 using errcode = 'P0001';
    end if;
    if nullif(e ->> 'price', '') is null or (e ->> 'price')::int < 0 then
      raise exception '請填寫「%」的售價', e ->> 'label' using errcode = 'P0001';
    end if;
    if nullif(e ->> 'qty_limit', '') is not null and (e ->> 'qty_limit')::int < 0 then
      raise exception '「%」的可預購數量不能是負數', e ->> 'label' using errcode = 'P0001';
    end if;
  end loop;

  if v_starts is not null and v_ends is not null and v_ends <= v_starts then
    raise exception '結束時間要晚於開始時間' using errcode = 'P0001';
  end if;

  if v_status = 'published' then
    if v_name = '' then
      raise exception '上架前請填寫商品名稱' using errcode = 'P0001';
    end if;
    if jsonb_array_length(v_images) = 0 then
      raise exception '上架前請至少放一張照片' using errcode = 'P0001';
    end if;
    if jsonb_array_length(v_variants) = 0 then
      raise exception '上架前請至少設定一個規格' using errcode = 'P0001';
    end if;
    if v_ends is null then
      raise exception '上架前請設定預購結束時間' using errcode = 'P0001';
    end if;
  end if;

  insert into public.products (id, name, description, status, starts_at, ends_at, ship_estimate, notice)
  values (
    v_id, v_name, coalesce(p ->> 'description', ''), v_status, v_starts, v_ends,
    btrim(coalesce(p ->> 'ship_estimate', '')), coalesce(p ->> 'notice', '')
  )
  on conflict (id) do update set
    name = excluded.name,
    description = excluded.description,
    status = excluded.status,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    ship_estimate = excluded.ship_estimate,
    notice = excluded.notice,
    updated_at = now()
  returning slug into v_slug;

  -- 照片：照傳入順序重建，回傳不再使用的檔案路徑讓前端清掉。
  select coalesce(jsonb_agg(i2.path), '[]'::jsonb) into v_removed
  from public.product_images i2
  where i2.product_id = v_id
    and i2.path not in (select x from jsonb_array_elements_text(v_images) x);

  delete from public.product_images i2 where i2.product_id = v_id;
  insert into public.product_images (product_id, path, position)
  select v_id, x.value, x.ordinality::int - 1
  from jsonb_array_elements_text(v_images) with ordinality x;

  -- 規格：保留既有 id，預購數量統計才不會歸零。
  v_keep := array(
    select (x ->> 'id')::uuid from jsonb_array_elements(v_variants) x
    where nullif(x ->> 'id', '') is not null
  );

  update public.product_variants v set archived = true
  where v.product_id = v_id and not (v.id = any (v_keep))
    and exists (select 1 from public.order_items i2 where i2.variant_id = v.id);

  delete from public.product_variants v
  where v.product_id = v_id and not (v.id = any (v_keep))
    and not exists (select 1 from public.order_items i2 where i2.variant_id = v.id);

  for i in 0 .. jsonb_array_length(v_variants) - 1 loop
    e := v_variants -> i;
    if nullif(e ->> 'id', '') is null then
      insert into public.product_variants (product_id, label, price, qty_limit, position)
      values (v_id, btrim(e ->> 'label'), (e ->> 'price')::int,
              nullif(e ->> 'qty_limit', '')::int, i);
    else
      update public.product_variants v set
        label = btrim(e ->> 'label'),
        price = (e ->> 'price')::int,
        qty_limit = nullif(e ->> 'qty_limit', '')::int,
        position = i,
        archived = false
      where v.id = (e ->> 'id')::uuid and v.product_id = v_id;
      if not found then
        raise exception '規格資料已變更，請重新開啟這個商品' using errcode = 'P0001';
      end if;
    end if;
  end loop;

  return jsonb_build_object('id', v_id, 'slug', v_slug, 'removed_paths', v_removed);
end;
$$;

-- 上架、下架與重新開放。重新開放時可一併傳入新的結束時間。
create or replace function public.admin_set_product_status(p_id uuid, p_status text, p_ends_at timestamptz default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.products%rowtype;
  v_ends timestamptz;
begin
  perform public.require_admin();
  if p_status not in ('published', 'hidden') then
    raise exception '商品狀態不正確' using errcode = 'P0001';
  end if;

  select * into v_row from public.products where id = p_id for update;
  if not found then
    raise exception '找不到這個商品' using errcode = 'P0001';
  end if;

  v_ends := coalesce(p_ends_at, v_row.ends_at);

  if p_status = 'published' then
    if btrim(v_row.name) = '' then
      raise exception '上架前請填寫商品名稱' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.product_images i where i.product_id = p_id) then
      raise exception '上架前請至少放一張照片' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.product_variants v where v.product_id = p_id and not v.archived) then
      raise exception '上架前請至少設定一個規格' using errcode = 'P0001';
    end if;
    if v_ends is null then
      raise exception '上架前請設定預購結束時間' using errcode = 'P0001';
    end if;
    if v_row.starts_at is not null and v_ends <= v_row.starts_at then
      raise exception '結束時間要晚於開始時間' using errcode = 'P0001';
    end if;
  end if;

  update public.products
  set status = p_status, ends_at = v_ends, updated_at = now()
  where id = p_id;

  return jsonb_build_object('id', p_id, 'status', p_status, 'ends_at', v_ends);
end;
$$;

-- 刪除商品。訂單明細保留下單當下的資料；回傳要清掉的照片路徑。
create or replace function public.admin_delete_product(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_paths jsonb;
begin
  perform public.require_admin();
  select coalesce(jsonb_agg(i.path), '[]'::jsonb) into v_paths
  from public.product_images i where i.product_id = p_id;
  delete from public.products where id = p_id;
  return jsonb_build_object('removed_paths', v_paths);
end;
$$;

create or replace function public.admin_list_orders(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_q       text := btrim(coalesce(p ->> 'q', ''));
  v_status  text := nullif(p ->> 'status', '');
  v_product uuid := nullif(p ->> 'product_id', '')::uuid;
  v_limit   int  := least(greatest(coalesce((p ->> 'limit')::int, 50), 1), 200);
  v_offset  int  := greatest(coalesce((p ->> 'offset')::int, 0), 0);
  v_like    text;
begin
  perform public.require_admin();
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return (
    with matched as (
      select o.*
      from public.orders o
      where (v_status is null or o.status = v_status)
        and (v_product is null or exists (
          select 1 from public.order_items i where i.order_id = o.id and i.product_id = v_product))
        and (v_q = '' or o.order_no ilike v_like or o.customer_name ilike v_like
             or o.customer_phone ilike v_like or o.customer_email ilike v_like)
    ),
    page as (
      select * from matched order by created_at desc, id limit v_limit offset v_offset
    )
    select jsonb_build_object(
      'total', (select count(*) from matched),
      'rows', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', o.id,
          'order_no', o.order_no,
          'status', o.status,
          'customer_name', o.customer_name,
          'customer_phone', o.customer_phone,
          'customer_email', o.customer_email,
          'arrival_notified_at', o.arrival_notified_at,
          'note', o.note,
          'items_total', o.items_total,
          'shipping_fee', o.shipping_fee,
          'total', o.total,
          'created_at', o.created_at,
          'items', (
            select jsonb_agg(jsonb_build_object(
              'product_name', i.product_name,
              'variant_label', i.variant_label,
              'unit_price', i.unit_price,
              'qty', i.qty,
              'line_total', i.line_total
            ) order by i.product_name, i.variant_label)
            from public.order_items i where i.order_id = o.id
          )
        ) order by o.created_at desc, o.id), '[]'::jsonb)
        from page o
      )
    )
  );
end;
$$;

-- 變更訂單狀態。把已取消的訂單改回來時，會重新檢查名額，避免超賣。
create or replace function public.admin_set_order_status(p_ids uuid[], p_status text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_count int;
  r record;
begin
  perform public.require_admin();
  if p_status not in ('new', 'confirmed', 'closed', 'processing', 'shipped', 'completed', 'cancelled') then
    raise exception '訂單狀態不正確' using errcode = 'P0001';
  end if;

  if p_status <> 'cancelled' then
    perform 1
    from public.product_variants v
    where v.id in (
      select i.variant_id
      from public.orders o
      join public.order_items i on i.order_id = o.id
      where o.id = any (p_ids) and o.status = 'cancelled'
    )
    order by v.id
    for update;

    for r in
      select v.id, v.label, v.qty_limit, sum(i.qty)::int as restoring
      from public.orders o
      join public.order_items i on i.order_id = o.id
      join public.product_variants v on v.id = i.variant_id
      where o.id = any (p_ids) and o.status = 'cancelled'
      group by v.id, v.label, v.qty_limit
      order by v.id
    loop
      if r.qty_limit is not null
         and public.variant_ordered_qty(r.id) + r.restoring > r.qty_limit then
        raise exception '「%」的名額已被其他訂單使用，無法恢復這筆訂單', r.label
          using errcode = 'P0001', hint = 'sold_out';
      end if;
    end loop;
  end if;

  update public.orders o
  set status = p_status, updated_at = now()
  where o.id = any (p_ids) and o.status <> p_status;
  get diagnostics v_count = row_count;

  return jsonb_build_object('updated', v_count);
end;
$$;

-- 到貨通知名單：這個商品尚未通知、未取消的訂單。同一個 Email 只列一次。
create or replace function public.admin_arrival_recipients(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  return (
    with target as (
      select o.id, o.customer_email, o.arrival_notified_at
      from public.orders o
      where o.status <> 'cancelled'
        and exists (select 1 from public.order_items i where i.order_id = o.id and i.product_id = p_id)
    )
    select jsonb_build_object(
      'name', p.name,
      'myship_url', p.myship_url,
      'order_ids', (select coalesce(jsonb_agg(t.id), '[]'::jsonb) from target t
                    where t.arrival_notified_at is null),
      'emails', (select coalesce(jsonb_agg(distinct t.customer_email), '[]'::jsonb) from target t
                 where t.arrival_notified_at is null and t.customer_email <> ''),
      'notified_count', (select count(*) from target t where t.arrival_notified_at is not null)
    )
    from public.products p
    where p.id = p_id
  );
end;
$$;

create or replace function public.admin_set_myship_url(p_id uuid, p_url text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_url text := btrim(coalesce(p_url, ''));
begin
  perform public.require_admin();
  if v_url <> '' and v_url !~* '^https://' then
    raise exception '賣場連結要以 https:// 開頭' using errcode = 'P0001';
  end if;
  update public.products set myship_url = v_url, updated_at = now() where id = p_id;
  return jsonb_build_object('myship_url', v_url);
end;
$$;

create or replace function public.admin_mark_notified(p_ids uuid[])
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_count int;
begin
  perform public.require_admin();
  update public.orders o
  set arrival_notified_at = now(), updated_at = now()
  where o.id = any (p_ids) and o.arrival_notified_at is null;
  get diagnostics v_count = row_count;
  return jsonb_build_object('updated', v_count);
end;
$$;

create or replace function public.admin_get_settings()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  return (
    select jsonb_build_object('shop_name', s.shop_name, 'tagline', s.tagline, 'contact', s.contact,
                              'shipping_fee', s.shipping_fee, 'notice', s.notice)
    from public.shop_settings s where s.id = 1
  );
end;
$$;

create or replace function public.admin_save_settings(p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p ->> 'shop_name', ''));
  v_fee  int  := nullif(p ->> 'shipping_fee', '')::int;
begin
  perform public.require_admin();
  if v_name = '' then
    raise exception '請填寫商店名稱' using errcode = 'P0001';
  end if;
  if v_fee is null or v_fee < 0 then
    raise exception '運費請填寫 0 以上的數字' using errcode = 'P0001';
  end if;
  update public.shop_settings
  set shop_name = v_name, shipping_fee = v_fee,
      tagline = btrim(coalesce(p ->> 'tagline', '')),
      contact = btrim(coalesce(p ->> 'contact', '')),
      notice = coalesce(p ->> 'notice', ''), updated_at = now()
  where id = 1;
  return public.admin_get_settings();
end;
$$;

-- ---------------------------------------------------------------------------
-- 函式權限：預設全部關閉，只開放明確列出的函式
-- ---------------------------------------------------------------------------

revoke all on all functions in schema public from public, anon, authenticated;

grant usage on schema public to anon, authenticated;

grant execute on function public.get_shop_info()              to anon, authenticated;
grant execute on function public.list_public_products()       to anon, authenticated;
grant execute on function public.get_public_product(text)     to anon, authenticated;
grant execute on function public.submit_preorder(jsonb)       to anon, authenticated;

grant execute on function public.is_admin()                                       to authenticated;
grant execute on function public.admin_dashboard()                                to authenticated;
grant execute on function public.admin_list_products()                            to authenticated;
grant execute on function public.admin_get_product(uuid)                          to authenticated;
grant execute on function public.admin_save_product(jsonb)                        to authenticated;
grant execute on function public.admin_set_product_status(uuid, text, timestamptz) to authenticated;
grant execute on function public.admin_delete_product(uuid)                       to authenticated;
grant execute on function public.admin_list_orders(jsonb)                         to authenticated;
grant execute on function public.admin_set_order_status(uuid[], text)             to authenticated;
grant execute on function public.admin_arrival_recipients(uuid)                   to authenticated;
grant execute on function public.admin_set_myship_url(uuid, text)                 to authenticated;
grant execute on function public.admin_mark_notified(uuid[])                      to authenticated;
grant execute on function public.admin_get_settings()                             to authenticated;
grant execute on function public.admin_save_settings(jsonb)                       to authenticated;

-- ---------------------------------------------------------------------------
-- 商品照片儲存空間：公開讀取，只有管理員能上傳、更換與刪除
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "admin_read_product_images"   on storage.objects;
drop policy if exists "admin_insert_product_images" on storage.objects;
drop policy if exists "admin_update_product_images" on storage.objects;
drop policy if exists "admin_delete_product_images" on storage.objects;

create policy "admin_read_product_images" on storage.objects
  for select to authenticated
  using (bucket_id = 'product-images' and public.is_admin());

create policy "admin_insert_product_images" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-images' and public.is_admin());

create policy "admin_update_product_images" on storage.objects
  for update to authenticated
  using (bucket_id = 'product-images' and public.is_admin())
  with check (bucket_id = 'product-images' and public.is_admin());

create policy "admin_delete_product_images" on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-images' and public.is_admin());

-- 通知 Supabase 重新讀取函式清單。
notify pgrst, 'reload schema';
