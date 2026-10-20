'use strict';
const $ = id => document.getElementById(id);
let snapshot = { items: [] }, mode = 'login', query = '', loading = false;
async function call(action, args = {}) {
  if (!window.garden) throw new Error('请从安装后的桌面应用打开；浏览器预览不连接账号服务');
  const result = await window.garden.call(action, args);
  if (!result.ok) throw new Error(result.error); return result.value;
}
function toast(message) { $('toast').textContent = message; $('toast').classList.add('visible'); clearTimeout(toast.timer); toast.timer = setTimeout(() => $('toast').classList.remove('visible'), 3000); }
function el(tag, text, cls) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; }
function button(text, label, action) { const b = el('button', text); b.setAttribute('aria-label', label); b.title = label; b.onclick = async () => { try { await action(); } catch (e) { toast(e.message); } }; return b; }
function renderCards(target, items) {
  target.replaceChildren();
  if (!items.length) { const e = el('div', undefined, 'empty'); e.append(el('span','🌱'), el('div',query ? '还没找到这条小记忆' : '花园还空着'), el('small',query ? '换个关键词试试吧' : '点击「开始记录」，或手动记下一条。\n已有剪贴板不会自动导入。')); target.append(e); return; }
  for (const item of items) {
    const card = el('article', undefined, 'card');
    const top = el('div',undefined,'card-top'); top.append(el('span',item.kind === 'image' ? '▧  图片记忆' : /^https?:\/\//.test(item.content) ? '↗  链接' : '≡  文字记忆'),el('span',item.conflict ? '冲突副本' : new Date(item.lastCopiedAt).toLocaleString('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})));
    const content = el('div',undefined,'card-content');
    if (item.kind === 'image') { const img = el('img'); img.src = item.content; img.alt = '剪贴板图片'; content.append(img); } else content.textContent = item.content;
    content.tabIndex = 0; content.setAttribute('role','button'); content.setAttribute('aria-label','查看完整内容');
    const detail = () => { $('detail').replaceChildren(); if (item.kind === 'image') { const img = el('img'); img.src=item.content; img.alt='完整图片'; $('detail').append(img); } else $('detail').textContent=item.content; $('detailDialog').showModal(); };
    content.onclick = detail; content.onkeydown = e => { if(e.key === 'Enter') detail(); };
    const bottom = el('div',undefined,'card-bottom'); bottom.append(el('span',`记录 ${item.copyCount} 次`));
    const actions = el('div',undefined,'card-actions');
    const pin = button(item.pinned ? '★' : '☆', item.pinned ? '取消置顶' : '置顶', async()=>{ await call('edit',{id:item.id,patch:{pinned:!item.pinned}}); await refresh(); }); if(item.pinned) pin.className='pinned';
    actions.append(pin,button('复制','复制内容',async()=>{await call('copy',{id:item.id});toast('已复制，小记忆又派上用场了');}),button('×','删除记录',async()=>{if(confirm('删除这条记录？已开启同步时，删除也会同步到其他设备。')) { await call('edit',{id:item.id,patch:{deleted:true}}); await refresh(); }}));
    bottom.append(actions); card.append(top,content,bottom); target.append(card);
  }
}
function render() {
  const items = snapshot.items.filter(i=>i.kind === 'image' ? !query || '图片'.includes(query) : i.content.toLowerCase().includes(query));
  renderCards($('recent'),[...items].sort((a,b)=>b.lastCopiedAt-a.lastCopiedAt).slice(0,100));
  renderCards($('frequent'),[...items].sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.copyCount-a.copyCount||b.lastCopiedAt-a.lastCopiedAt).slice(0,100));
  $('cancelHuawei').hidden = !snapshot.huaweiPending;
  $('pause').textContent = snapshot.paused ? '开始记录' : '暂停记录';
  $('account').textContent = snapshot.user ? '我的账号' : '游客模式 · 登录';
  $('syncBanner').textContent = snapshot.user ? `${snapshot.user.email} · ${snapshot.message || '账号花园'}${snapshot.pending ? ` · ${snapshot.pending} 条待同步` : ''}` : '🌱 游客也能自在使用。记录只留在本机，登录后可选择合并并跨设备同步。';
  $('status').textContent = `${snapshot.paused ? '○ 记录已暂停' : '● 正在本机记住'} · ${snapshot.items.length} 条记忆`;
  $('sync').textContent = snapshot.busy ? '正在同步…' : '同步一下 ↗';
  if (snapshot.user && $('authDialog').open) $('authDialog').close();
}
async function refresh() { try { snapshot = await call('snapshot'); render(); } catch(e) { toast(e.message); } }
function safe(fn) { return async (...args)=>{try {await fn(...args);} catch(e) {toast(e.message);} }; }
$('search').oninput = e=>{query=e.target.value.toLowerCase().trim();render();};
$('pause').onclick=safe(async()=>{await call('settings',{paused:!snapshot.paused});await refresh();});
$('sync').onclick=safe(async()=>{if(!snapshot.user) return $('authDialog').showModal();await call('sync');await refresh();});
$('add').onclick=()=>$('addDialog').showModal();
$('addForm').onsubmit=safe(async e=>{e.preventDefault();await call('add',{content:$('newContent').value});$('newContent').value='';$('addDialog').close();await refresh();});
function settings(){ $('serverUrl').value=snapshot.server; $('syncToggle').checked=snapshot.syncEnabled; $('syncToggle').disabled=!snapshot.user; $('logout').hidden=!snapshot.user; $('settingsError').textContent=''; $('settingsDialog').showModal(); }
$('settings').onclick=settings;
$('account').onclick=()=>snapshot.user ? settings() : $('authDialog').showModal();
$('saveSettings').onclick=async()=>{try {await call('settings',{server:$('serverUrl').value,syncEnabled:$('syncToggle').checked});$('settingsDialog').close();await refresh();}catch(e){$('settingsError').textContent=e.message;}};
$('export').onclick=safe(()=>call('export'));
$('logout').onclick=safe(async()=>{await call('logout');$('settingsDialog').close();await refresh();});
function authMode(next){mode=next;$('loginTab').classList.toggle('selected',mode==='login');$('registerTab').classList.toggle('selected',mode==='register');$('authSubmit').textContent=mode==='login'?'登录并同步':'注册并同步';$('authForm').elements.password.autocomplete=mode==='login'?'current-password':'new-password';$('authError').textContent='';}
$('loginTab').onclick=()=>authMode('login');$('registerTab').onclick=()=>authMode('register');
$('authForm').onsubmit=async e=>{e.preventDefault();if(loading)return;loading=true;$('authSubmit').disabled=true;$('authError').textContent='';try {await call('login',{mode,email:e.target.elements.email.value,password:e.target.elements.password.value,mergeGuest:$('mergeGuest').checked});e.target.elements.password.value='';$('authDialog').close();await refresh();}catch(err){$('authError').textContent=err.message;}finally{loading=false;$('authSubmit').disabled=false;}};
$('huawei').onclick=async()=>{try{await call('huawei',{mergeGuest:$('mergeGuest').checked});toast('请在系统浏览器完成华为账号授权');}catch(e){$('authError').textContent=e.message;}};
$('cancelHuawei').onclick=safe(async()=>{await call('cancelHuawei');toast('已取消华为登录');});
for(const b of document.querySelectorAll('[data-close]')) b.onclick=()=>$(b.dataset.close).close();
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='f'){e.preventDefault();$('search').focus();}});
if(window.garden){window.garden.onChange(()=>refresh());refresh();}else{snapshot={items:[],paused:true,server:'http://127.0.0.1:4318',syncEnabled:false};render();$('syncBanner').textContent='界面预览 · 账号、剪贴板与同步功能请使用安装版。';}
