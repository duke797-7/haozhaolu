-- 把管理員帳號加入名單。
-- 先在 Supabase 的 Authentication > Users 建立帳號，
-- 再把下面的 Email 改成那個帳號，貼到 SQL Editor 執行。

insert into public.admins (user_id)
select id from auth.users where email = '改成你的Email'
on conflict (user_id) do nothing;

-- 執行後應該看到 1 筆資料；若是 0 筆，代表 Email 打錯或帳號尚未建立。
select u.email, a.created_at
from public.admins a
join auth.users u on u.id = a.user_id;
