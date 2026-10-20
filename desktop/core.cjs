const { randomUUID, createHash } = require('node:crypto');
const hash = text => createHash('sha256').update(text).digest('hex');
const privateHost = host => host === 'localhost' || host === '[::1]' || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host);
const emptySpace = () => ({ items: [], pending: {}, cursor: 0 });
function initialState() {
  return { version: 1, active: 'guest', spaces: { guest: emptySpace() }, sessions: {}, server: 'http://127.0.0.1:4318', paused: true, syncEnabled: false };
}
class Garden {
  constructor(state = initialState(), persist = () => {}, request = fetch) { this.state = state; this.persist = persist; this.request = request; this.busy = false; this.message = ''; }
  save() { this.persist(this.state); }
  get space() { return this.state.spaces[this.state.active]; }
  snapshot() {
    return { items: this.space.items.filter(i => !i.deleted), paused: this.state.paused, server: this.state.server,
      user: this.state.sessions[this.state.active]?.user || null, syncEnabled: this.state.syncEnabled,
      pending: Object.keys(this.space.pending).length, message: this.message, busy: this.busy };
  }
  change(item) {
    item.updatedAt = Date.now();
    if (this.state.active !== 'guest') this.space.pending[item.id] = { id: item.id, opId: randomUUID(), baseRevision: item.revision || 0, payload: { ...item } };
    this.save();
  }
  capture(kind, content) {
    if (!content || (kind === 'text' && Buffer.byteLength(content) > 2 * 1024 * 1024) || (kind === 'image' && content.length > 28 * 1024 * 1024)) return;
    let item = this.space.items.find(i => !i.deleted && i.kind === kind && hash(i.content) === hash(content));
    const now = Date.now();
    if (item) { item.copyCount++; item.lastCopiedAt = now; }
    else { item = { id: randomUUID(), kind, content, copyCount: 1, pinned: false, deleted: false, createdAt: now, updatedAt: now, lastCopiedAt: now, revision: 0 }; this.space.items.push(item); }
    this.change(item); return item;
  }
  edit(id, patch) {
    const item = this.space.items.find(i => i.id === id);
    if (!item) throw new Error('记录不存在');
    if ('pinned' in patch) item.pinned = Boolean(patch.pinned);
    if (patch.deleted) { item.deleted = true; item.content = ''; }
    this.change(item);
  }
  configure(settings) {
    if ('server' in settings) {
      const u = new URL(settings.server);
      if (!(u.protocol === 'https:' || (u.protocol === 'http:' && privateHost(u.hostname))) || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw new Error('服务地址须为 HTTPS 或本机/私有局域网 HTTP，且不带路径');
      const next = u.origin;
      if (next !== this.state.server && Object.keys(this.state.sessions).length) throw new Error('更换服务器前请退出账号；不同服务的数据保留在各自数据文件中');
      this.state.server = next;
    }
    if ('paused' in settings) this.state.paused = Boolean(settings.paused);
    if ('syncEnabled' in settings) this.state.syncEnabled = Boolean(settings.syncEnabled);
    this.save();
  }
  async api(path, data, token) {
    const res = await this.request(this.state.server + path, { method: data === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(data !== undefined ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(20000) });
    const body = await res.json(); if (!res.ok || body.error) throw new Error(body.error || '请求失败'); return body;
  }
  async login(mode, email, password, mergeGuest = false) {
    const auth = await this.api('/v1/auth/' + (mode === 'register' ? 'register' : 'login'), { email, password });
    this.useSession(auth, mergeGuest);
  }
  useSession(auth, mergeGuest = false) {
    if (!auth?.token || !auth.user?.id) throw new Error('登录响应不正确');
    const key = auth.user.id;
    this.state.spaces[key] ||= emptySpace(); this.state.sessions[key] = auth; this.state.active = key;
    if (mergeGuest) {
      for (const old of this.state.spaces.guest.items.filter(i => !i.deleted)) {
        const item = { ...old, id: randomUUID(), revision: 0 }; this.space.items.push(item); this.change(item);
      }
      // Move only after all local writes succeed; retain guest data unless user chose merge.
      this.state.spaces.guest = emptySpace();
    }
    this.state.syncEnabled = true; this.message = '已登录，正在准备同步'; this.save();
  }
  async logout() {
    if (this.busy) throw new Error('同步进行中，请稍后退出');
    const session = this.state.sessions[this.state.active];
    if (session) { try { await this.api('/v1/auth/logout', {}, session.token); } catch { /* Local logout always clears token. Server session expires. */ } }
    delete this.state.sessions[this.state.active]; this.state.active = 'guest'; this.state.syncEnabled = false; this.message = ''; this.save();
  }
  async sync() {
    const s = this.state.sessions[this.state.active];
    if (!s || !this.state.syncEnabled || this.busy) return;
    const account = this.state.active, space = this.space; this.busy = true;
    try {
      let pages = 0, more;
      do {
        const operations = []; let bytes = 0;
        for (const op of Object.values(space.pending).slice(0, 20)) {
          const size = Buffer.byteLength(JSON.stringify(op));
          if (operations.length && bytes + size > 29 * 1024 * 1024) break;
          operations.push(op); bytes += size;
        }
        const result = await this.api('/v1/sync', { cursor: space.cursor, operations }, s.token);
        if (account !== this.state.active) return;
        for (const ack of result.accepted) {
          const item = space.items.find(i => i.id === ack.id); if (item) item.revision = ack.revision;
          const pending = space.pending[ack.id];
          if (pending?.opId === ack.opId) delete space.pending[ack.id];
          else if (pending) { pending.baseRevision = ack.revision; pending.payload.revision = ack.revision; }
        }
        for (const conflict of result.conflicts) {
          const item = space.items.find(i => i.id === conflict.id);
          if (item && !item.deleted) {
            const copy = { ...item, id: randomUUID(), revision: 0, conflict: true };
            space.items.push(copy); this.change(copy);
          }
          delete space.pending[conflict.id];
          if (conflict.remote && item) Object.assign(item, conflict.remote);
          this.message = '发现多设备冲突，已保留服务端版本和本机副本';
        }
        for (const remote of result.changes) {
          const local = space.items.find(i => i.id === remote.id);
          if (space.pending[remote.id]) continue;
          if (!local) space.items.push(remote);
          else if ((local.revision || 0) <= remote.revision) Object.assign(local, remote);
        }
        space.cursor = result.cursor; this.save();
        more = result.hasMore || Object.keys(space.pending).length > 0;
      } while (more && ++pages < 50);
      if (!this.message.includes('冲突')) this.message = '上次同步 ' + new Date().toLocaleTimeString('zh-CN');
    } catch (e) { this.message = e.message + ' · 数据仍保存在本机'; }
    finally { this.busy = false; this.save(); }
  }
}
module.exports = { Garden, initialState };
