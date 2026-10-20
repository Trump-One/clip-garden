import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
const scrypt = promisify(scryptCb);
const digest = value => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const SESSION_MS = 30 * 86400000;
const MAX_BODY = 30 * 1024 * 1024;
const UUID = /^[0-9a-f-]{36}$/i;
async function json(req) {
  let size = 0, chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) fail(413, '内容太大，单次请求最多 30 MB');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); }
  catch { fail(400, 'JSON 格式不正确'); }
}
export function createApp({ database = ':memory:', env = process.env, upstreamFetch = fetch } = {}) {
  if (database !== ':memory:') mkdirSync(dirname(database), { recursive: true });
  const db = new DatabaseSync(database);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, email TEXT UNIQUE, salt TEXT, hash TEXT, huawei TEXT UNIQUE);
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, user TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS clips(user TEXT NOT NULL REFERENCES users(id), id TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(user,id));
    CREATE TABLE IF NOT EXISTS changes(seq INTEGER PRIMARY KEY AUTOINCREMENT, user TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS changes_user_seq ON changes(user,seq);
    CREATE TABLE IF NOT EXISTS operations(user TEXT NOT NULL, op TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(user,op));
    CREATE TABLE IF NOT EXISTS oauth(id TEXT PRIMARY KEY, state TEXT UNIQUE, pollhash TEXT NOT NULL, expires INTEGER NOT NULL, claimed INTEGER DEFAULT 0, result TEXT);`);
  const rates = new Map();
  function limit(key, maximum = 30) {
    const now = Date.now();
    if (rates.size > 10000) for (const [k,v] of rates) if (v.until < now) rates.delete(k);
    let r = rates.get(key);
    if (!r || r.until < now) { r = { count: 0, until: now + 60000 }; rates.set(key, r); }
    if (++r.count > maximum) fail(429, '请求太频繁，请稍后再试');
  }
  function session(user) {
    const token = secret();
    db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token), user.id, Date.now() + SESSION_MS);
    return { token, user: { id: user.id, email: user.email || '华为账号' } };
  }
  function current(req) {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    const row = db.prepare('SELECT users.* FROM sessions JOIN users ON sessions.user=users.id WHERE sessions.hash=? AND expires>?').get(digest(token), Date.now());
    if (!row) fail(401, '登录已过期，请重新登录');
    return row;
  }
  function oauthConfig() {
    if (!env.HUAWEI_CLIENT_ID || !env.HUAWEI_CLIENT_SECRET || !env.HUAWEI_REDIRECT_URI) fail(503, '华为账号尚未配置：请先在服务端设置应用凭据');
  }
  async function exchangeHuawei(code) {
    const response = await upstreamFetch('https://oauth-login.cloud.huawei.com/oauth2/v3/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: env.HUAWEI_CLIENT_ID,
        client_secret: env.HUAWEI_CLIENT_SECRET, redirect_uri: env.HUAWEI_REDIRECT_URI }), signal: AbortSignal.timeout(15000)
    });
    const tokens = await response.json();
    if (!response.ok || !tokens.access_token) fail(502, '华为授权码验证失败，请重试');
    const info = await upstreamFetch('https://account.cloud.huawei.com/rest.php?nsp_svc=GOpen.User.getInfo', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ access_token: tokens.access_token }), signal: AbortSignal.timeout(15000)
    });
    const profile = await info.json();
    if (!info.ok || typeof profile.openID !== 'string' || !profile.openID) fail(502, '无法获取经华为验证的账号身份');
    // One OAuth client ID across platforms => the same OpenID. Never trust a client-supplied OpenID/email.
    let user = db.prepare('SELECT * FROM users WHERE huawei=?').get(profile.openID);
    if (!user) {
      const id = randomUUID();
      db.prepare('INSERT INTO users(id,huawei) VALUES(?,?)').run(id, profile.openID);
      user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    }
    return session(user);
  }
  function sync(user, body) {
    const { cursor = 0, operations = [] } = body;
    if (!Number.isSafeInteger(cursor) || cursor < 0 || !Array.isArray(operations) || operations.length > 50) fail(400, '同步参数不正确');
    const accepted = [], conflicts = [];
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const op of operations) {
        if (!op || !UUID.test(op.opId || '') || !UUID.test(op.id || '') || !Number.isSafeInteger(op.baseRevision) || op.baseRevision < 0) fail(400, '记录标识或版本不正确');
        const fingerprint = digest(JSON.stringify(op));
        const replay = db.prepare('SELECT * FROM operations WHERE user=? AND op=?').get(user.id, op.opId);
        if (replay) {
          if (replay.fingerprint !== fingerprint) fail(409, '相同操作编号不能重复用于不同内容');
          accepted.push(JSON.parse(replay.result)); continue;
        }
        const old = db.prepare('SELECT * FROM clips WHERE user=? AND id=?').get(user.id, op.id);
        if ((old?.revision || 0) !== op.baseRevision) {
          conflicts.push({ id: op.id, opId: op.opId, remote: old ? JSON.parse(old.payload) : null }); continue;
        }
        const p = op.payload;
        if (!p || !['text','image'].includes(p.kind) || typeof p.content !== 'string' || typeof p.deleted !== 'boolean' || typeof p.pinned !== 'boolean' || !Number.isSafeInteger(p.copyCount) || p.copyCount < 1 || p.copyCount > 2147483647) fail(400, '记录内容不正确');
        if (p.kind === 'text' && Buffer.byteLength(p.content) > 2 * 1024 * 1024) fail(413, '文字最多 2 MB');
        if (p.kind === 'image' && (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(p.content) || p.content.length > 28 * 1024 * 1024)) fail(413, '图片须为 PNG 且不超过 20 MB');
        if (p.content.length === 0 && !p.deleted) fail(400, '内容不能为空');
        // Bounds are server-enforced, client timestamps are presentation only.
        const stamp = value => Number.isSafeInteger(value) && value > 0 && value < Date.now() + 86400000 ? value : Date.now();
        const item = { id: op.id, kind: p.kind, content: p.deleted ? '' : p.content, deleted: p.deleted, pinned: p.pinned,
          copyCount: p.copyCount, createdAt: stamp(p.createdAt), updatedAt: Date.now(), lastCopiedAt: stamp(p.lastCopiedAt), revision: (old?.revision || 0) + 1 };
        const encoded = JSON.stringify(item);
        const usage = db.prepare('SELECT COALESCE(SUM(length(payload)),0) AS bytes FROM clips WHERE user=? AND id<>?').get(user.id, op.id).bytes;
        if (usage + encoded.length > 200 * 1024 * 1024) fail(413, '账号同步空间上限为 200 MB，请清理记录');
        db.prepare('INSERT INTO clips VALUES(?,?,?,?) ON CONFLICT(user,id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload').run(user.id, op.id, item.revision, encoded);
        db.prepare('UPDATE changes SET payload=? WHERE user=? AND id=?').run(encoded, user.id, op.id);
        db.prepare('INSERT INTO changes(user,id,payload) VALUES(?,?,?)').run(user.id, op.id, encoded);
        const result = { id: op.id, opId: op.opId, revision: item.revision };
        db.prepare('INSERT INTO operations VALUES(?,?,?,?)').run(user.id, op.opId, fingerprint, JSON.stringify(result));
        accepted.push(result);
      }
      const rows = db.prepare('SELECT seq,payload FROM changes WHERE user=? AND seq>? ORDER BY seq LIMIT 101').all(user.id, cursor);
      const page = rows.slice(0, 100);
      const result = { accepted, conflicts, changes: page.map(r => JSON.parse(r.payload)), cursor: page.at(-1)?.seq || cursor, hasMore: rows.length > 100 };
      db.exec('COMMIT'); return result;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const server = createServer(async (req, res) => {
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); };
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      const ip = req.socket.remoteAddress; // Never trust arbitrary X-Forwarded-For.
      limit(ip + ':all', 240);
      if (req.headers.origin) fail(403, '此 API 仅供原生客户端使用');
      if (req.method === 'GET' && path === '/health') return send(200, { ok: true, version: '0.1.0' });
      if (req.method === 'POST' && ['/v1/auth/register','/v1/auth/login'].includes(path)) {
        limit(ip + ':auth', 15);
        const b = await json(req);
        const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || typeof b.password !== 'string' || b.password.length < 10 || b.password.length > 128) fail(400, '请输入有效邮箱和 10–128 位密码');
        const exists = db.prepare('SELECT * FROM users WHERE email=?').get(email);
        if (path.endsWith('register')) {
          if (exists) fail(409, '该邮箱已注册');
          const salt = secret(); const hash = (await scrypt(b.password, salt, 64)).toString('hex');
          const user = { id: randomUUID(), email };
          try { db.prepare('INSERT INTO users(id,email,salt,hash) VALUES(?,?,?,?)').run(user.id, email, salt, hash); }
          catch { fail(409, '该邮箱已注册'); }
          return send(201, session(user));
        }
        const hash = await scrypt(b.password, exists?.salt || 'dummy-login-salt', 64);
        if (!exists?.hash || !timingSafeEqual(hash, Buffer.from(exists.hash, 'hex'))) fail(401, '邮箱或密码不正确');
        return send(200, session(exists));
      }
      if (req.method === 'POST' && path === '/v1/auth/huawei/start') {
        limit(ip + ':auth', 15); oauthConfig();
        db.prepare('DELETE FROM oauth WHERE expires<?').run(Date.now());
        const id = randomUUID(), state = secret(), pollSecret = secret();
        db.prepare('INSERT INTO oauth(id,state,pollhash,expires) VALUES(?,?,?,?)').run(id, state, digest(pollSecret), Date.now() + 5 * 60000);
        const url = new URL('https://oauth-login.cloud.huawei.com/oauth2/v3/authorize');
        for (const [k,v] of Object.entries({ client_id: env.HUAWEI_CLIENT_ID, redirect_uri: env.HUAWEI_REDIRECT_URI, response_type: 'code', scope: 'openid profile', state })) url.searchParams.set(k,v);
        return send(200, { id, pollSecret, url: url.href });
      }
      if (req.method === 'GET' && path === '/v1/auth/huawei/callback') {
        oauthConfig(); const q = new URL(req.url, 'http://localhost').searchParams;
        const row = db.prepare('SELECT * FROM oauth WHERE state=? AND expires>? AND claimed=0').get(q.get('state'), Date.now());
        if (!row) fail(400, '华为登录状态已过期或不匹配');
        db.prepare('UPDATE oauth SET claimed=1 WHERE id=?').run(row.id);
        try {
          if (q.get('error') || !q.get('code')) fail(400, '你已取消华为登录');
          const result = await exchangeHuawei(q.get('code'));
          db.prepare('UPDATE oauth SET result=? WHERE id=?').run(JSON.stringify(result), row.id);
        } catch { db.prepare('UPDATE oauth SET result=? WHERE id=?').run(JSON.stringify({ error: '华为登录未完成，请重试' }), row.id); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'" });
        return res.end('<!doctype html><meta charset="utf-8"><title>剪贴花园</title><h1>请返回剪贴花园查看登录结果</h1>');
      }
      if (req.method === 'POST' && path === '/v1/auth/huawei/poll') {
        const b = await json(req); const row = db.prepare('SELECT * FROM oauth WHERE id=? AND pollhash=? AND expires>?').get(b.id || '', digest(b.pollSecret || ''), Date.now());
        if (!row) fail(400, '华为登录已过期');
        if (!row.result) return send(200, { pending: true });
        db.prepare('DELETE FROM oauth WHERE id=?').run(row.id); return send(200, JSON.parse(row.result));
      }
      const user = current(req);
      if (req.method === 'GET' && path === '/v1/me') return send(200, { id: user.id, email: user.email || '华为账号' });
      if (req.method === 'POST' && path === '/v1/auth/logout') {
        db.prepare('DELETE FROM sessions WHERE hash=?').run(digest((req.headers.authorization || '').replace(/^Bearer /,'')));
        return send(200, { ok: true });
      }
      if (req.method === 'POST' && path === '/v1/sync') return send(200, sync(user, await json(req)));
      fail(404, '接口不存在');
    } catch (error) { send(error.status || 500, { error: error.status ? error.message : '服务暂时不可用，请稍后重试' }); }
  });
  server.requestTimeout = 30000; server.headersTimeout = 15000;
  server.on('close', () => db.close());
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createApp({ database: process.env.DATABASE_PATH || './data/clipgarden.sqlite' });
  server.listen(Number(process.env.PORT || 4318), process.env.HOST || '127.0.0.1', () => console.log('Clip Garden API listening on port', server.address().port));
}
