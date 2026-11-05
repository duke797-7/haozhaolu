// 僅供本機測試：以 Supabase 相同的網址與行為包住真實 PostgreSQL。
// 每個請求都切換成 anon / authenticated 角色執行，所以權限與 RLS 是資料庫真正檢查的結果。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_PORT = Number(process.env.API_PORT || 54330);
const APP_PORT = Number(process.env.APP_PORT || 4173);
const PG_PORT = process.env.PGTEST_PORT || '54329';
const API_KEY = 'local-anon-key';
const FILES = '/var/tmp/preorder-files';
const DIST = path.join(ROOT, 'dist');

fs.rmSync(FILES, { recursive: true, force: true });
fs.mkdirSync(FILES, { recursive: true });

export const USERS = {
  'admin@example.com': { id: '11111111-1111-1111-1111-111111111111', password: 'admin-pass-123', admin: true },
  'stranger@example.com': { id: '22222222-2222-2222-2222-222222222222', password: 'stranger-pass-123', admin: false },
};

function psql(sql, user = 'postgres') {
  return new Promise((resolve) => {
    const child = spawn('psql', [
      '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
      '-h', '127.0.0.1', '-p', PG_PORT, '-U', user, '-d', 'postgres',
    ]);
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => resolve({ code, out: out.trim(), err }));
    child.stdin.end(sql);
  });
}

const lit = (value) => {
  const tag = `q${randomUUID().replaceAll('-', '')}`;
  return `$${tag}$${value}$${tag}$`;
};

function pgError(err) {
  const m = /ERROR:\s+([0-9A-Z]{5}):\s+(.*)/.exec(err);
  const hint = /HINT:\s+(.*)/.exec(err);
  return { code: m?.[1] ?? 'XX000', message: m?.[2] ?? err.trim(), details: null, hint: hint?.[1] ?? null };
}

const statusFor = (code) => {
  if (code === '42501') return 403;
  if (code === 'P0001') return 400;
  if (code?.startsWith('22')) return 400;
  return 500;
};

function context(user, req) {
  const role = user ? 'authenticated' : 'anon';
  const claims = user ? { sub: user.id, role } : { role };
  const headers = { 'x-forwarded-for': req.headers['x-test-ip'] || '127.0.0.1' };
  return `begin;
set local role ${role};
select set_config('request.jwt.claims', ${lit(JSON.stringify(claims))}, true) \\g /dev/null
select set_config('request.headers', ${lit(JSON.stringify(headers))}, true) \\g /dev/null
`;
}

let signatures = {};
async function loadSignatures() {
  const { out } = await psql(`
    select json_object_agg(p.proname, json_build_object(
      'names', coalesce(to_json(p.proargnames), '[]'::json),
      'types', (select coalesce(json_agg(format_type(t, null) order by o), '[]'::json)
                from unnest(p.proargtypes::oid[]) with ordinality u(t, o))))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public';`);
  signatures = JSON.parse(out);
}

function argExpr(value, type) {
  if (value === null || value === undefined) return `null::${type}`;
  if (type === 'jsonb') return `${lit(JSON.stringify(value))}::jsonb`;
  if (type.endsWith('[]')) {
    return `array(select jsonb_array_elements_text(${lit(JSON.stringify(value))}::jsonb))::${type}`;
  }
  return `${lit(String(value))}::${type}`;
}

const sessions = new Map();

function issue(user) {
  const access_token = `access.${randomUUID()}`;
  const refresh_token = `refresh.${randomUUID()}`;
  sessions.set(access_token, user);
  sessions.set(refresh_token, user);
  return {
    access_token, refresh_token, token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: user.id, email: user.email },
  };
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(payload);
}

async function handleRpc(req, res, name, user) {
  const sig = signatures[name];
  if (!sig) return send(res, 404, { code: 'PGRST202', message: `找不到函式 ${name}` });
  const raw = (await readBody(req)).toString() || '{}';
  const args = JSON.parse(raw);
  const known = Object.keys(args).every((k) => sig.names.includes(k));
  if (!known) return send(res, 404, { code: 'PGRST202', message: `函式 ${name} 的參數不符` });
  const list = sig.names
    .map((n, i) => (n in args ? `${n} => ${argExpr(args[n], sig.types[i])}` : null))
    .filter(Boolean)
    .join(', ');
  const { code, out, err } = await psql(`${context(user, req)}
select coalesce(to_json(r.v), 'null'::json) from (select public.${name}(${list}) as v) r;
commit;`);
  if (code !== 0) {
    const e = pgError(err);
    return send(res, statusFor(e.code), e);
  }
  return send(res, 200, out || 'null');
}

// 測試用：直接查資料表，驗證匿名者確實被資料庫擋下。
async function handleTable(req, res, table, user) {
  const { code, out, err } = await psql(`${context(user, req)}
select coalesce(json_agg(t), '[]'::json) from (select * from public."${table.replaceAll('"', '')}" limit 100) t;
commit;`);
  if (code !== 0) {
    const e = pgError(err);
    return send(res, statusFor(e.code), e);
  }
  return send(res, 200, out);
}

async function handleStorage(req, res, url, user) {
  const parts = url.pathname.split('/').filter(Boolean).slice(2); // object/...
  if (parts[0] !== 'object') return send(res, 404, { message: 'not found' });

  if (req.method === 'GET' && parts[1] === 'public') {
    const bucket = parts[2];
    const name = parts.slice(3).join('/');
    const { out } = await psql(`select public from storage.buckets where id = ${lit(bucket)};`);
    const file = path.join(FILES, bucket, name);
    if (out !== 't' || !fs.existsSync(file)) return send(res, 404, { message: 'not found' });
    const meta = JSON.parse(fs.readFileSync(`${file}.meta`, 'utf8'));
    return send(res, 200, fs.readFileSync(file), { 'Content-Type': meta.type });
  }

  const bucket = parts[1];
  if (req.method === 'POST') {
    const name = parts.slice(2).join('/');
    const type = req.headers['content-type'] || '';
    const body = await readBody(req);
    const { out: rule } = await psql(
      `select file_size_limit, allowed_mime_types from storage.buckets where id = ${lit(bucket)};`
    );
    if (!rule) return send(res, 404, { message: 'Bucket not found' });
    const [limit, mimes] = rule.split('|');
    if (body.length > Number(limit)) return send(res, 413, { message: 'Payload too large' });
    if (!mimes.replace(/[{}]/g, '').split(',').includes(type)) {
      return send(res, 415, { message: `mime type ${type} is not supported` });
    }
    const { code, err } = await psql(`${context(user, req)}
insert into storage.objects (bucket_id, name) values (${lit(bucket)}, ${lit(name)});
commit;`);
    if (code !== 0) return send(res, 403, { message: 'new row violates row-level security policy', error: pgError(err).code });
    const file = path.join(FILES, bucket, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    fs.writeFileSync(`${file}.meta`, JSON.stringify({ type }));
    return send(res, 200, { Key: `${bucket}/${name}` });
  }

  if (req.method === 'DELETE') {
    const { prefixes = [] } = JSON.parse((await readBody(req)).toString() || '{}');
    const removed = [];
    for (const name of prefixes) {
      const { code, out } = await psql(`${context(user, req)}
delete from storage.objects where bucket_id = ${lit(bucket)} and name = ${lit(name)} returning name;
commit;`);
      if (code === 0 && out) {
        removed.push({ name });
        fs.rmSync(path.join(FILES, bucket, name), { force: true });
        fs.rmSync(path.join(FILES, bucket, `${name}.meta`), { force: true });
      }
    }
    return send(res, 200, removed);
  }
  return send(res, 405, { message: 'method not allowed' });
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-test-ip, x-upsert, cache-control',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

const api = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
  if (req.method === 'OPTIONS') return send(res, 204, '');

  const url = new URL(req.url, `http://127.0.0.1:${API_PORT}`);
  try {
    if (url.pathname.startsWith('/storage/v1/object/public/')) {
      return await handleStorage(req, res, url, null);
    }
    if (req.headers.apikey !== API_KEY) return send(res, 401, { message: 'No API key found in request' });

    if (url.pathname === '/auth/v1/token') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      if (url.searchParams.get('grant_type') === 'password') {
        const user = USERS[body.email];
        if (!user || user.password !== body.password) {
          return send(res, 400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
        }
        return send(res, 200, issue({ ...user, email: body.email }));
      }
      const user = sessions.get(body.refresh_token);
      if (!user) return send(res, 400, { error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
      sessions.delete(body.refresh_token);
      return send(res, 200, issue(user));
    }

    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const user = bearer ? sessions.get(bearer) : null;
    if (bearer && !user) return send(res, 401, { code: 'PGRST301', message: 'JWT expired' });

    if (url.pathname === '/auth/v1/logout') {
      sessions.delete(bearer);
      return send(res, 204, '');
    }
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      return await handleRpc(req, res, url.pathname.split('/').pop(), user);
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      return await handleTable(req, res, url.pathname.split('/').pop(), user);
    }
    if (url.pathname.startsWith('/storage/v1/')) {
      return await handleStorage(req, res, url, user);
    }
    return send(res, 404, { message: 'not found' });
  } catch (e) {
    console.error(e);
    return send(res, 500, { message: String(e) });
  }
});

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
};

const app = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${APP_PORT}`);
  if (url.pathname === '/config.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    return res.end(`window.APP_CONFIG={supabaseUrl:"http://127.0.0.1:${API_PORT}",supabaseAnonKey:"${API_KEY}"};`);
  }
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = path.join(DIST, path.normalize(rel));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  if (file.endsWith('index.html')) {
    // 正式版只允許連到 supabase.co；本機測試時把模擬伺服器加入白名單，其餘安全標頭維持不變。
    const local = `http://127.0.0.1:${API_PORT}`;
    return res.end(fs.readFileSync(file, 'utf8').replaceAll('https://*.supabase.co', `https://*.supabase.co ${local}`));
  }
  return res.end(fs.readFileSync(file));
});

async function seedUsers() {
  const values = Object.entries(USERS).map(([email, u]) => `('${u.id}', '${email}')`).join(',');
  await psql(`insert into auth.users (id, email) values ${values} on conflict do nothing;
    insert into public.admins (user_id)
    select id from auth.users where email = 'admin@example.com' on conflict do nothing;`);
}

await seedUsers();
await loadSignatures();
api.listen(API_PORT, '127.0.0.1');
app.listen(APP_PORT, '127.0.0.1');
console.log(`api http://127.0.0.1:${API_PORT}  app http://127.0.0.1:${APP_PORT}`);
