-- 完成資料庫設定（只需要執行一次）
-- 使用前：先到 Authentication > Users 建立你的管理員帳號。
-- 使用方式：貼到 SQL Editor，按 Run。結果應該列出你的 Email。

-- 送出預購單
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

-- 儲存商品
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

-- 刪除商品
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

-- 開放函式權限
revoke all on function public.submit_preorder(jsonb)      from public, anon, authenticated;
revoke all on function public.admin_save_product(jsonb)   from public, anon, authenticated;
revoke all on function public.admin_delete_product(uuid)  from public, anon, authenticated;
grant execute on function public.submit_preorder(jsonb)     to anon, authenticated;
grant execute on function public.admin_save_product(jsonb)  to authenticated;
grant execute on function public.admin_delete_product(uuid) to authenticated;

-- 把目前唯一的帳號設為管理員。若已有多個帳號，這一步不會執行，避免加錯人。
insert into public.admins (user_id)
select u.id from auth.users u
where (select count(*) from auth.users) = 1
on conflict (user_id) do nothing;

notify pgrst, 'reload schema';

-- 應該列出你的 Email；若沒有資料，代表帳號尚未建立或帳號超過一個。
select u.email as admin_email, a.created_at
from public.admins a
join auth.users u on u.id = a.user_id;
