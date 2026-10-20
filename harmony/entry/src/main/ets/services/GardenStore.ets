import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import { http } from '@kit.NetworkKit';
import { util } from '@kit.ArkTS';
import { asset } from '@kit.AssetStoreKit';

export class Clip {
  id: string = util.generateRandomUUID();
  kind: string = 'text';
  content: string = '';
  pinned: boolean = false;
  deleted: boolean = false;
  copyCount: number = 1;
  createdAt: number = Date.now();
  updatedAt: number = Date.now();
  lastCopiedAt: number = Date.now();
  revision: number = 0;
}
class Operation { id: string = ''; opId: string = ''; baseRevision: number = 0; payload: Clip = new Clip(); }
class Space { items: Clip[] = []; pending: Operation[] = []; cursor: number = 0; }
export class User { id: string = ''; email: string = ''; }
class Session { token: string = ''; user: User = new User(); }
class Ack { id: string = ''; opId: string = ''; revision: number = 0; }
class Conflict { id: string = ''; opId: string = ''; remote: Clip = new Clip(); }
class SyncResult { accepted: Ack[] = []; conflicts: Conflict[] = []; changes: Clip[] = []; cursor: number = 0; hasMore: boolean = false; }
class ErrorResult { error: string = ''; }
export class OAuthFlow { id: string = ''; pollSecret: string = ''; url: string = ''; }
class PollResult extends Session { pending: boolean = false; }
class SyncRequest { cursor: number = 0; operations: Operation[] = []; }
class LoginRequest { email: string = ''; password: string = ''; }
class PollRequest { id: string = ''; pollSecret: string = ''; }

export class GardenStore {
  prefs?: preferences.Preferences;
  space: Space = new Space();
  user: User = new User();
  token: string = '';
  server: string = 'https://sync.example.com';
  syncing: boolean = false;
  syncEnabled: boolean = true;
  message: string = '';
  private context?: common.UIAbilityContext;
  private secretAlias: string = 'clipgarden-session';
  private key(): string { return this.user.id || 'guest'; }
  async init(context: common.UIAbilityContext, storageName: string = 'garden-v1'): Promise<void> {
    this.context = context;
    this.secretAlias = storageName === 'garden-v1' ? 'clipgarden-session' : storageName + '-session';
    this.prefs = await preferences.getPreferences(context, { name: storageName });
    this.server = await this.prefs.get('server', this.server) as string;
    this.syncEnabled = await this.prefs.get('syncEnabled', true) as boolean;
    this.user = JSON.parse(await this.prefs.get('user', '{"id":"","email":""}') as string) as User;
    this.token = this.user.id ? this.readSecret() : '';
    if (!this.token) this.user = new User();
    await this.loadSpace();
  }
  private async loadSpace(): Promise<void> {
    this.space = JSON.parse(await this.prefs?.get('space:' + this.key(), '{"items":[],"pending":[],"cursor":0}') as string) as Space;
  }
  private readSecret(): string {
    try {
      let query: asset.AssetMap = new Map();
      query.set(asset.Tag.ALIAS, new util.TextEncoder().encodeInto(this.secretAlias));
      query.set(asset.Tag.RETURN_TYPE, asset.ReturnType.ALL);
      const rows = asset.querySync(query);
      if (!rows.length) return '';
      const stored = JSON.parse(util.TextDecoder.create('utf-8').decodeWithStream(rows[0].get(asset.Tag.SECRET) as Uint8Array)) as Session;
      return stored.user.id === this.user.id ? stored.token : '';
    } catch { return ''; }
  }
  private setSecret(value: string): void {
    let query: asset.AssetMap = new Map();
    query.set(asset.Tag.ALIAS, new util.TextEncoder().encodeInto(this.secretAlias));
    try { asset.removeSync(query); } catch { /* first login */ }
    if (value.length > 0) {
      query.set(asset.Tag.SECRET, new util.TextEncoder().encodeInto(value));
      query.set(asset.Tag.ACCESSIBILITY, asset.Accessibility.DEVICE_FIRST_UNLOCKED);
      asset.addSync(query);
    }
  }
  async save(): Promise<void> {
    await this.prefs?.put('space:' + this.key(), JSON.stringify(this.space));
    await this.prefs?.put('user', JSON.stringify(this.user));
    await this.prefs?.put('server', this.server);
    await this.prefs?.put('syncEnabled', this.syncEnabled);
    await this.prefs?.flush();
  }
  visible(): Clip[] { return this.space.items.filter((x: Clip) => !x.deleted); }
  private mark(item: Clip): void {
    item.updatedAt = Date.now();
    if (this.user.id) {
      this.space.pending = this.space.pending.filter((p: Operation) => p.id !== item.id);
      const op = new Operation(); op.id = item.id; op.opId = util.generateRandomUUID(); op.baseRevision = item.revision;
      op.payload = JSON.parse(JSON.stringify(item)) as Clip; this.space.pending.push(op);
    }
  }
  async add(content: string, kind: string = 'text'): Promise<void> {
    if (!content) return;
    if ((kind === 'text' && new util.TextEncoder().encodeInto(content).length > 2 * 1024 * 1024) || content.length > 28 * 1024 * 1024) throw new Error('内容太大');
    let item = this.visible().find((x: Clip) => x.kind === kind && x.content === content);
    if (item) { item.copyCount++; item.lastCopiedAt = Date.now(); }
    else { item = new Clip(); item.kind = kind; item.content = content; this.space.items.push(item); }
    this.mark(item); await this.save();
  }
  async edit(id: string, remove: boolean): Promise<void> {
    const item = this.space.items.find((x: Clip) => x.id === id); if (!item) return;
    if (remove) { item.deleted = true; item.content = ''; } else item.pinned = !item.pinned;
    this.mark(item); await this.save();
  }
  async request(path: string, body: string = '', authorized: boolean = false): Promise<string> {
    const client = http.createHttp();
    try {
      const response = await client.request(this.server + path, {
        method: body ? http.RequestMethod.POST : http.RequestMethod.GET,
        header: { 'Content-Type': 'application/json', 'Authorization': authorized ? 'Bearer ' + this.token : '' },
        extraData: body, connectTimeout: 15000, readTimeout: 20000, expectDataType: http.HttpDataType.STRING
      });
      const result = response.result as string;
      if (response.responseCode < 200 || response.responseCode >= 300) { const e = JSON.parse(result) as ErrorResult; throw new Error(e.error || '服务不可用'); }
      const err = JSON.parse(result) as ErrorResult; if (err.error) throw new Error(err.error);
      return result;
    } finally { client.destroy(); }
  }
  async configure(url: string, enabled: boolean): Promise<void> {
    const https = /^https:\/\/[a-zA-Z0-9.-]+(:\d+)?$/.test(url);
    const local = /^http:\/\/(127\.0\.0\.1|localhost|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2[0-9]|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/.test(url);
    if (!https && !local) throw new Error('请填写 HTTPS 域名，或本机/私有局域网 HTTP 地址，不带末尾斜线');
    if (this.user.id && url !== this.server) throw new Error('更换服务地址前请先退出账号');
    this.server = url; this.syncEnabled = enabled; await this.save();
  }
  private async useSession(auth: Session, merge: boolean): Promise<void> {
    if (!auth.token || !auth.user.id) throw new Error('登录未完成');
    const guest = JSON.parse(await this.prefs?.get('space:guest', '{"items":[],"pending":[],"cursor":0}') as string) as Space;
    this.setSecret(JSON.stringify(auth)); this.token = auth.token; this.user = auth.user;
    await this.loadSpace();
    if (merge) {
      for (const old of guest.items.filter((x: Clip) => !x.deleted)) {
        const item = JSON.parse(JSON.stringify(old)) as Clip; item.id = util.generateRandomUUID(); item.revision = 0;
        this.space.items.push(item); this.mark(item);
      }
      await this.save(); await this.prefs?.put('space:guest', JSON.stringify(new Space()));
    }
    this.syncEnabled = true; await this.save(); await this.sync();
  }
  async login(email: string, password: string, register: boolean, merge: boolean): Promise<void> {
    if (this.syncing) throw new Error('同步中，请稍后');
    const body = new LoginRequest(); body.email = email; body.password = password;
    const auth = JSON.parse(await this.request('/v1/auth/' + (register ? 'register' : 'login'), JSON.stringify(body))) as Session;
    await this.useSession(auth, merge);
  }
  async startHuawei(): Promise<OAuthFlow> {
    const flow = JSON.parse(await this.request('/v1/auth/huawei/start', '{}')) as OAuthFlow;
    if (!flow.url.startsWith('https://oauth-login.cloud.huawei.com/')) throw new Error('授权地址不正确');
    await this.context?.openLink(flow.url); return flow;
  }
  async pollHuawei(flow: OAuthFlow, merge: boolean): Promise<boolean> {
    const body = new PollRequest(); body.id = flow.id; body.pollSecret = flow.pollSecret;
    const result = JSON.parse(await this.request('/v1/auth/huawei/poll', JSON.stringify(body))) as PollResult;
    if (result.pending) return false; await this.useSession(result, merge); return true;
  }
  async logout(): Promise<void> {
    if (this.syncing) throw new Error('同步中，请稍后退出');
    try { await this.request('/v1/auth/logout', '{}', true); } catch { /* clear local credentials even offline */ }
    await this.save(); this.setSecret(''); this.token = ''; this.user = new User();
    await this.loadSpace(); await this.save();
  }
  async sync(): Promise<void> {
    if (!this.token || this.syncing || !this.syncEnabled) return;
    this.syncing = true;
    try {
      let more = true; let pages = 0;
      while (more && pages++ < 50) {
        const body = new SyncRequest(); body.cursor = this.space.cursor; let bytes = 0;
        for (const op of this.space.pending.slice(0, 20)) {
          const size = new util.TextEncoder().encodeInto(JSON.stringify(op)).length;
          if (body.operations.length > 0 && bytes + size > 29 * 1024 * 1024) break;
          body.operations.push(op); bytes += size;
        }
        const result = JSON.parse(await this.request('/v1/sync', JSON.stringify(body), true)) as SyncResult;
        for (const ack of result.accepted) {
          const item = this.space.items.find((x: Clip) => x.id === ack.id); if (item) item.revision = ack.revision;
          const pending = this.space.pending.find((p: Operation) => p.id === ack.id);
          if (pending && pending.opId !== ack.opId) { pending.baseRevision = ack.revision; pending.payload.revision = ack.revision; }
          else this.space.pending = this.space.pending.filter((p: Operation) => p.id !== ack.id);
        }
        for (const c of result.conflicts) {
          const local = this.space.items.find((x: Clip) => x.id === c.id);
          if (local && !local.deleted) {
            const copy = JSON.parse(JSON.stringify(local)) as Clip; copy.id = util.generateRandomUUID(); copy.revision = 0;
            this.space.items.push(copy); this.mark(copy);
          }
          this.space.pending = this.space.pending.filter((p: Operation) => p.id !== c.id);
          this.space.items = this.space.items.filter((x: Clip) => x.id !== c.id);
          this.space.items.push(c.remote); this.message = '多设备冲突：已保留服务端记录和本机副本';
        }
        for (const remote of result.changes) {
          if (this.space.pending.some((p: Operation) => p.id === remote.id)) continue;
          const old = this.space.items.find((x: Clip) => x.id === remote.id);
          if (!old || old.revision <= remote.revision) { this.space.items = this.space.items.filter((x: Clip) => x.id !== remote.id); this.space.items.push(remote); }
        }
        this.space.cursor = result.cursor; await this.save();
        more = result.hasMore || this.space.pending.length > 0;
      }
      if (!this.message.includes('冲突')) this.message = '已同步 · ' + new Date().toLocaleTimeString();
    } catch (e) { this.message = (e as Error).message + ' · 记录仍保存在本机'; }
    finally { this.syncing = false; }
  }
}
