#!/usr/bin/env bash
# 建立一個全新的本機 PostgreSQL，模擬 Supabase 的權限環境後套用 schema.sql。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN=/usr/lib/postgresql/16/bin
DATA="${PGTEST_DATA:-/var/tmp/preorder-pg}"
PORT="${PGTEST_PORT:-54329}"
RUN="su postgres -s /bin/bash -c"

$RUN "$PGBIN/pg_ctl -D $DATA -m immediate stop" >/dev/null 2>&1 || true
rm -rf "$DATA"
mkdir -p "$DATA"
chown postgres "$DATA"

$RUN "$PGBIN/initdb -D $DATA -U supabase_admin --auth=trust --encoding=UTF8 --locale=C.UTF-8" >/dev/null
$RUN "$PGBIN/pg_ctl -D $DATA -o '-p $PORT -k /tmp -c listen_addresses=127.0.0.1' -l /var/tmp/preorder-pg.log -w start" >/dev/null

ADMIN="psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $PORT -U supabase_admin -d postgres"
OWNER="psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $PORT -U postgres -d postgres"

$ADMIN -f "$ROOT/tests/supabase-shim.sql"
# 與 Supabase 相同：以非超級使用者 postgres 身分套用。
$OWNER -f "$ROOT/supabase/schema.sql"
# 再套用一次，確認可以重複執行。
$OWNER -f "$ROOT/supabase/schema.sql"
echo "db ready on port $PORT"
