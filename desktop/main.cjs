const { app, BrowserWindow, ipcMain, clipboard, ClipboardItem, globalShortcut, nativeImage, shell, safeStorage, dialog, Tray, Menu } = require('electron');
const { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { fileURLToPath } = require('node:url');
const { createHash } = require('node:crypto');
const { Garden, initialState } = require('./core.cjs');
const { createClipboardAdapter } = require('./clipboard.cjs');
const clipAdapter = createClipboardAdapter({ clipboard, ClipboardItem, nativeImage });
let clipQueue = Promise.resolve(), captureBusy = false;
function withClipboard(fn) { const result = clipQueue.then(fn); clipQueue = result.catch(() => {}); return result; }
let win, tray, garden, last = '', captureTimer, syncTimer, oauthFlow, quitting = false;
const contentHash = x => createHash('sha256').update(x).digest('hex');
function notify() { if (win && !win.isDestroyed()) win.webContents.send('garden:changed'); }
function show() { win.show(); win.focus(); }
async function capture() {
  if (captureBusy) return;
  captureBusy = true;
  try {
    await withClipboard(async () => {
      const clip = await clipAdapter.read();
      if (!clip) { last = ''; return; }
      const key = contentHash(clip.content);
      if (key !== last) { last = key; garden.capture(clip.kind, clip.content); notify(); }
    });
  } catch (e) { garden.message = '剪贴板读取失败：' + e.message; notify(); }
  finally { captureBusy = false; }
}
async function beginHuawei(mergeGuest) {
  if (oauthFlow) throw new Error('华为登录正在进行，请先完成或取消');
  const flow = await garden.api('/v1/auth/huawei/start', {});
  const url = new URL(flow.url);
  if (url.protocol !== 'https:' || url.hostname !== 'oauth-login.cloud.huawei.com') throw new Error('华为授权地址不正确');
  oauthFlow = { ...flow, mergeGuest, expires: Date.now() + 5 * 60000 };
  await shell.openExternal(url.href);
  return { ok: true };
}
async function pollHuawei() {
  if (!oauthFlow) return;
  const flow = oauthFlow;
  if (Date.now() > flow.expires) { oauthFlow = null; garden.message = '华为登录已超时'; notify(); return; }
  try {
    const result = await garden.api('/v1/auth/huawei/poll', { id: flow.id, pollSecret: flow.pollSecret });
    if (!result.pending && oauthFlow === flow) { oauthFlow = null; garden.useSession(result, flow.mergeGuest); await garden.sync(); notify(); }
  } catch (e) { oauthFlow = null; garden.message = e.message; notify(); }
}
const actions = {
  snapshot: () => ({ ...garden.snapshot(), huaweiPending: Boolean(oauthFlow), openAtLogin: app.getLoginItemSettings().openAtLogin }),
  settings: async args => {
    if (oauthFlow) throw new Error('请先取消华为登录');
    garden.configure(args); notify();
    if ('openAtLogin' in args) app.setLoginItemSettings({ openAtLogin: Boolean(args.openAtLogin) });
  },
  add: args => { garden.capture('text', String(args.content || '')); notify(); },
  edit: args => { garden.edit(args.id, args.patch || {}); notify(); },
  copy: async args => {
    const item = garden.space.items.find(i => i.id === args.id && !i.deleted); if (!item) throw new Error('记录不存在');
    await withClipboard(async () => { await clipAdapter.write(item); last = contentHash(item.content); }); // Application copies do not inflate usage.
  },
  login: async args => { if (garden.busy || oauthFlow) throw new Error('请等待当前操作完成'); await garden.login(args.mode, args.email, args.password, Boolean(args.mergeGuest)); await garden.sync(); notify(); },
  huawei: args => beginHuawei(Boolean(args.mergeGuest)),
  cancelHuawei: () => { oauthFlow = null; },
  logout: async () => { oauthFlow = null; await garden.logout(); notify(); },
  sync: async () => { await garden.sync(); notify(); },
  export: async () => {
    const result = await dialog.showSaveDialog(win, { title: '导出当前花园（包含明文内容）', defaultPath: 'clip-garden-export.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (!result.canceled) writeFileSync(result.filePath, JSON.stringify(garden.snapshot().items, null, 2), { mode: 0o600 });
  }
};
app.setName('剪贴花园 Next');
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => win && show());
  app.whenReady().then(async () => {
    const folder = app.getPath('userData'); mkdirSync(folder, { recursive: true });
    const statePath = join(folder, 'garden-v1.enc');
    if (!safeStorage.isEncryptionAvailable()) { dialog.showErrorBox('无法安全保存数据', '系统密钥存储不可用，请解锁系统钥匙串后重启。'); app.quit(); return; }
    let state = initialState();
    try { if (existsSync(statePath)) state = JSON.parse(safeStorage.decryptString(readFileSync(statePath))); }
    catch { dialog.showErrorBox('本机数据无法读取', '为保护原有数据，应用已停止启动。请恢复系统钥匙串或从备份恢复。'); app.quit(); return; }
    const configuredServer = initialState().server;
    if (configuredServer !== 'https://sync.example.com' && (state.server === 'http://127.0.0.1:4318' || state.server === 'https://sync.example.com')) state.server = configuredServer;
    garden = new Garden(state, value => {
      const tmp = statePath + '.tmp'; writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(value)), { mode: 0o600 }); renameSync(tmp, statePath);
    });
    win = new BrowserWindow({ width: 1120, height: 800, minWidth: 760, minHeight: 580, title: '剪贴花园 Next', backgroundColor: '#f8f3e4',
      webPreferences: { preload: join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
    const uiPath = resolve(__dirname, '../ui/index.html');
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', e => e.preventDefault());
    win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ipcMain.handle('garden:call', async (event, action, args = {}) => {
      if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || fileURLToPath(event.senderFrame.url) !== uiPath || !Object.hasOwn(actions, action)) throw new Error('不允许的操作');
      try { const value = await actions[action](args); return { ok: true, value }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    win.loadFile(uiPath);
    win.on('close', e => { if (!quitting) { e.preventDefault(); win.hide(); } });
    const icon = nativeImage.createFromPath(join(__dirname, 'icon.png'));
    tray = new Tray(icon.resize({ width: 18, height: 18 })); tray.setToolTip('剪贴花园 Next');
    tray.setContextMenu(Menu.buildFromTemplate([{ label: '打开剪贴花园', click: show }, { label: '退出', click: () => { quitting = true; app.quit(); } }]));
    tray.on('click', show);
    if (!globalShortcut.register('CommandOrControl+Shift+V', () => win.isVisible() ? win.hide() : show())) garden.message = '快捷键注册失败，请使用托盘打开花园';
    // Sync must start independently of clipboard access or permission errors.
    syncTimer = setInterval(async () => {
      try { await garden.sync(); await pollHuawei(); }
      catch (e) { garden.message = e.message; }
      notify();
    }, 5000);
    try { const c = await withClipboard(() => clipAdapter.read()); last = c ? contentHash(c.content) : ''; }
    catch (e) { garden.message = '剪贴板读取失败：' + e.message; }
    captureTimer = setInterval(capture, 1000);
    app.on('activate', show);
  }).catch(error => { dialog.showErrorBox('应用启动失败', error.message); app.quit(); });
}
app.on('before-quit', () => { quitting = true; clearInterval(captureTimer); clearInterval(syncTimer); globalShortcut.unregisterAll(); });
