import { common } from '@kit.AbilityKit';
import { pasteboard } from '@kit.BasicServicesKit';
import { image } from '@kit.ImageKit';
import { util } from '@kit.ArkTS';
import { GardenStore, Clip, OAuthFlow } from '../services/GardenStore';
@Entry
@Component
struct Index {
  @State items: Clip[] = [];
  @State search: string = '';
  @State page: string = 'garden';
  @State frequent: boolean = false;
  @State email: string = '';
  @State password: string = '';
  @State registering: boolean = false;
  @State mergeGuest: boolean = false;
  @State account: string = '';
  @State message: string = '';
  @State server: string = 'https://sync.example.com';
  @State syncEnabled: boolean = true;
  @State busy: boolean = false;
  @State content: string = '';
  private store: GardenStore = new GardenStore();
  private timer: number = -1;
  private flow?: OAuthFlow;
  private flowMerge: boolean = false;
  private flowExpires: number = 0;
  private initialized: boolean = false;
  async aboutToAppear(): Promise<void> {
    try { await this.store.init(this.getUIContext().getHostContext() as common.UIAbilityContext); this.initialized = true; this.refresh(); this.startTimer(); }
    catch (e) { this.message = '无法读取本机花园：' + (e as Error).message; }
  }
  aboutToDisappear(): void { this.stopTimer(); }
  onPageHide(): void { this.stopTimer(); }
  onPageShow(): void { if (this.initialized) this.startTimer(); }
  private startTimer(): void {
    this.stopTimer(); this.timer = setInterval(async () => {
      if (this.busy) return;
      try {
        if (this.flow) {
          if (Date.now() > this.flowExpires) { this.flow = undefined; this.message = '华为登录超时，请重试'; }
          else if (await this.store.pollHuawei(this.flow, this.flowMerge)) { this.flow = undefined; this.page = 'garden'; }
        }
        await this.store.sync(); this.refresh();
      } catch (e) { this.flow = undefined; this.message = (e as Error).message; }
    }, 5000);
  }
  private stopTimer(): void { if (this.timer !== -1) clearInterval(this.timer); this.timer = -1; }
  private refresh(): void { this.items = this.store.visible(); this.account = this.store.user.email; this.server = this.store.server; this.syncEnabled = this.store.syncEnabled; if (this.store.message) this.message = this.store.message; }
  private filtered(): Clip[] {
    const q = this.search.toLowerCase();
    return this.items.filter((x: Clip) => x.kind === 'image' ? !q || '图片'.includes(q) : x.content.toLowerCase().includes(q)).sort((a: Clip, b: Clip) => this.frequent ? Number(b.pinned) - Number(a.pinned) || b.copyCount - a.copyCount || b.lastCopiedAt - a.lastCopiedAt : b.lastCopiedAt - a.lastCopiedAt);
  }
  private async readClipboard(): Promise<void> {
    try {
      const data = await pasteboard.getSystemPasteboard().getData(); let saved = false;
      for (let i = 0; i < data.getRecordCount(); i++) {
        const record = data.getRecord(i);
        if (record.pixelMap) {
          const info = await record.pixelMap.getImageInfo(); if (info.size.width * info.size.height > 30000000) throw new Error('图片最多 3000 万像素');
          const packer = image.createImagePacker();
          try { const bytes = await packer.packing(record.pixelMap, { format: 'image/png', quality: 100 }); if (bytes.byteLength > 20 * 1024 * 1024) throw new Error('图片最多 20 MB'); await this.store.add('data:image/png;base64,' + new util.Base64Helper().encodeToStringSync(new Uint8Array(bytes)), 'image'); saved = true; }
          finally { packer.release(); }
          break;
        }
      }
      if (!saved) { const text = data.getPrimaryText(); if (!text) throw new Error('剪贴板暂无文字或图片'); await this.store.add(text); }
      this.message = '已加入花园'; this.refresh(); await this.store.sync(); this.refresh();
    } catch (e) { this.message = (e as Error).message; }
  }
  private async copy(item: Clip): Promise<void> {
    try {
      if (item.kind === 'image') {
        const bytes = new util.Base64Helper().decodeSync(item.content.slice(item.content.indexOf(',') + 1));
        const source = image.createImageSource(bytes.buffer as ArrayBuffer); const pixelMap = await source.createPixelMap();
        try { await pasteboard.getSystemPasteboard().setData(pasteboard.createData(pasteboard.MIMETYPE_PIXELMAP, pixelMap)); }
        finally { pixelMap.release(); source.release(); }
      } else await pasteboard.getSystemPasteboard().setData(pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, item.content));
      this.message = '已复制';
    } catch (e) { this.message = (e as Error).message; }
  }
  private async edit(item: Clip, remove: boolean): Promise<void> {
    try { await this.store.edit(item.id, remove); this.refresh(); await this.store.sync(); this.refresh(); }
    catch (e) { this.message = (e as Error).message; }
  }
  private async login(): Promise<void> {
    if (this.busy || this.flow) return; this.busy = true;
    try { await this.store.login(this.email, this.password, this.registering, this.mergeGuest); this.password = ''; this.page = 'garden'; this.refresh(); }
    catch (e) { this.message = (e as Error).message; }
    finally { this.busy = false; }
  }
  private async huawei(): Promise<void> {
    if (this.flow || this.busy) return;
    this.busy = true;
    try {
      this.flowMerge = this.mergeGuest;
      this.flowExpires = Date.now() + 5 * 60 * 1000;
      this.flow = await this.store.startHuawei();
      this.message = '请在系统浏览器完成华为授权，返回应用后会自动登录';
    }
    catch (e) { this.message = (e as Error).message; }
    finally { this.busy = false; }
  }
  @Builder header() {
    Row({ space: 8 }) {
      Column({ space: 4 }) { Text('❀ 剪贴花园').fontSize(25).fontWeight(FontWeight.Bold).fontColor('#34433D'); Text('CLIP GARDEN · NEXT').fontSize(9).letterSpacing(2).fontColor('#8B9682') }.alignItems(HorizontalAlign.Start)
      Blank()
      Button('⚙').fontColor('#34433D').backgroundColor('#ECEEDD').onClick(() => { this.page = 'settings'; this.message = ''; })
      Button(this.account ? '我的' : '登录').fontColor('#34433D').backgroundColor('#C4DFCF').onClick(() => { this.page = this.account ? 'settings' : 'auth'; this.message = ''; })
    }.width('100%').padding({ top: 20, bottom: 20 })
  }
  @Builder gardenPage() {
    Column({ space: 18 }) {
      Column({ space: 10 }) {
        Text('YOUR QUIET LITTLE MEMORY').fontSize(9).letterSpacing(2).fontColor('#8B9682')
        Text('复制过的小事，\n都替你记得。').fontSize(32).fontWeight(FontWeight.Bold).fontColor('#34433D')
        Text(this.account ? this.account + ' · 账号花园' : '🌱 游客模式 · 小记忆只留在本机').fontSize(12).fontColor('#7B8C77')
      }.width('100%').alignItems(HorizontalAlign.Start).padding({ top: 12, bottom: 6 })
      TextInput({ placeholder: '找找以前复制过的文字…', text: this.search }).onChange((v: string) => this.search = v).backgroundColor('#FFFEF8').border({ width: 1, color: '#657460' }).height(48)
      Row({ space: 10 }) {
        PasteButton({ icon: PasteIconStyle.LINES, text: PasteDescription.PASTE, buttonType: ButtonType.Capsule }).fontColor('#34433D').backgroundColor('#C4DFCF').width('45%').onClick((_event: ClickEvent, result: PasteButtonOnClickResult) => { if (result === PasteButtonOnClickResult.SUCCESS) this.readClipboard(); })
        Button('＋ 记一条').fontColor('#34433D').backgroundColor('#F5C69E').layoutWeight(1).onClick(() => this.page = 'add')
      }.width('100%')
      Text('点击「粘贴」收录文字或图片。鸿蒙端仅在用户操作时读取剪贴板。').fontSize(10).fontColor('#929B86').width('100%')
      Row({ space: 10 }) {
        Button('◷ 最近的小记忆').fontColor('#34433D').backgroundColor(this.frequent ? '#F1F0E5' : '#DEE8D8').onClick(() => this.frequent = false)
        Button('✧ 常用的心头好').fontColor('#34433D').backgroundColor(this.frequent ? '#DEE8D8' : '#F1F0E5').onClick(() => this.frequent = true)
      }.width('100%')
      if (this.filtered().length === 0) {
        Column({ space: 12 }) { Text('🌱').fontSize(36); Text(this.search ? '还没找到这条小记忆' : '花园还空着').fontColor('#7B8C77'); Text('粘贴或手动记下一点灵感吧').fontSize(12).fontColor('#929B86') }.width('100%').padding(32).border({ width: 1, color: '#C2CBB6', style: BorderStyle.Dashed }).borderRadius(16)
      }
      ForEach(this.filtered(), (item: Clip) => {
        Column({ space: 14 }) {
          Row() { Text(item.kind === 'image' ? '▧ 图片记忆' : '≡ 文字记忆').fontSize(11).fontColor('#8B9682'); Blank(); Text(new Date(item.lastCopiedAt).toLocaleDateString()).fontSize(10).fontColor('#8B9682') }.width('100%')
          if (item.kind === 'image') { Image(item.content).width('100%').height(180).objectFit(ImageFit.Contain) }
          else { Text(item.content).fontSize(15).fontColor('#34433D').lineHeight(25).copyOption(CopyOptions.InApp).width('100%') }
          Row({ space: 8 }) {
            Text('记录 ' + item.copyCount + ' 次').fontSize(10).fontColor('#8B9682'); Blank()
            Button(item.pinned ? '★' : '☆').fontColor('#9A774C').backgroundColor('#F6F1E3').onClick(() => this.edit(item, false))
            Button('复制').fontSize(12).fontColor('#34433D').backgroundColor('#E5ECDD').onClick(() => this.copy(item))
            Button('删除').fontSize(12).fontColor('#A46C54').backgroundColor('#F7EEE3').onClick(() => {
              this.getUIContext().showAlertDialog({ title: '删除这条记录？', message: '开启同步时，删除也会同步到其他设备。', primaryButton: { value: '取消', action: () => {} }, secondaryButton: { value: '删除', action: () => this.edit(item, true) } });
            })
          }.width('100%')
        }.alignItems(HorizontalAlign.Start).padding(18).width('100%').backgroundColor('#FFFEF8').border({ width: 1, color: '#7B8972' }).borderRadius(16)
      }, (item: Clip) => item.id + ':' + item.updatedAt + ':' + item.revision)
      Row() { Text(this.items.length + ' 条小记忆').fontSize(11).fontColor('#8B9682'); Blank(); Button('同步一下 ↗').fontColor('#557D61').backgroundColor('#E7EEDC').onClick(async () => { await this.store.sync(); this.refresh(); }) }.width('100%')
    }.width('100%')
  }
  @Builder authPage() {
    Column({ space: 18 }) {
      Text(this.registering ? '在花园安个家' : '欢迎回到花园').fontSize(28).fontWeight(FontWeight.Bold).fontColor('#34433D')
      Text('登录，让小记忆在设备间相遇。').fontSize(13).fontColor('#8B9682')
      TextInput({ placeholder: '邮箱', text: this.email }).type(InputType.Email).onChange((v: string) => this.email = v)
      TextInput({ placeholder: '密码，至少 10 位', text: this.password }).type(InputType.Password).onChange((v: string) => this.password = v)
      Row({ space: 6 }) { Checkbox().select(this.mergeGuest).selectedColor('#7BA78B').onChange((v: boolean) => this.mergeGuest = v); Text('将游客记录合并到账号并上传同步').fontSize(12).fontColor('#657460').layoutWeight(1) }.width('100%')
      Text('未勾选时游客数据留在本机。账号记录同步到配置的服务，服务端可读取内容。').fontSize(11).fontColor('#929B86')
      Button(this.registering ? '注册并同步' : '登录并同步').width('100%').enabled(!this.busy && !this.flow).fontColor('#34433D').backgroundColor('#C4DFCF').onClick(() => this.login())
      Button(this.registering ? '已有账号，去登录' : '没有账号，注册一个').fontColor('#657460').backgroundColor('#F1F0E5').onClick(() => this.registering = !this.registering)
      Button('华为账号登录').width('100%').fontColor('#34433D').backgroundColor('#F5C69E').enabled(!this.flow && !this.busy).onClick(() => this.huawei())
      if (this.flow) { Button('取消华为登录').fontColor('#657460').backgroundColor('#F1F0E5').onClick(() => { this.flow = undefined; this.message = '已取消'; }) }
      Text('通过系统浏览器完成华为账号授权，返回后自动登录。').fontSize(11).fontColor('#929B86')
      Button('先以游客身份逛逛').fontColor('#657460').backgroundColor('#F1F0E5').onClick(() => this.page = 'garden')
    }.width('100%').padding({ top: 30 })
  }
  @Builder settingsPage() {
    Column({ space: 18 }) {
      Text('花园设置').fontSize(28).fontWeight(FontWeight.Bold).fontColor('#34433D')
      Text('三端填写同一个服务地址，不带路径').fontSize(12).fontColor('#8B9682')
      TextInput({ placeholder: 'https://sync.example.com', text: this.server }).onChange((v: string) => this.server = v)
      Row() { Text('开启账号同步').fontColor('#34433D'); Blank(); Toggle({ type: ToggleType.Switch, isOn: this.syncEnabled }).onChange((v: boolean) => this.syncEnabled = v) }.width('100%')
      Text('本机和私有局域网支持 HTTP 测试，传输未加密，请用测试账号。账号令牌由系统 Asset Store 保存，历史记录位于私有沙箱。服务端未实现端到端加密。').fontSize(12).fontColor('#8B9682').lineHeight(22)
      Button('保存设置').width('100%').fontColor('#34433D').backgroundColor('#C4DFCF').onClick(async () => { try { if (this.flow) throw new Error('请先取消华为登录'); await this.store.configure(this.server.trim(), this.syncEnabled); this.page = 'garden'; this.refresh(); } catch (e) { this.message = (e as Error).message; } })
      if (this.account) { Text(this.account).fontColor('#657460'); Button('退出账号').fontColor('#A46C54').backgroundColor('#F5E6D5').onClick(async () => { try { this.flow = undefined; await this.store.logout(); this.refresh(); this.page = 'garden'; } catch (e) { this.message = (e as Error).message; } }) }
      Button('回到花园').fontColor('#657460').backgroundColor('#F1F0E5').onClick(() => this.page = 'garden')
    }.width('100%').padding({ top: 30 })
  }
  build() {
    Scroll() {
      Column({ space: 12 }) {
        this.header()
        if (this.page === 'auth') { this.authPage() }
        else if (this.page === 'settings') { this.settingsPage() }
        else if (this.page === 'add') {
          Text('种下一点小记忆').fontSize(26).fontWeight(FontWeight.Bold).fontColor('#34433D')
          TextArea({ placeholder: '写下一闪而过的灵感…', text: this.content }).height(220).onChange((v: string) => this.content = v)
          Button('保存到花园').fontColor('#34433D').backgroundColor('#C4DFCF').onClick(async () => { try { await this.store.add(this.content); this.content = ''; this.refresh(); this.page = 'garden'; await this.store.sync(); this.refresh(); } catch (e) { this.message = (e as Error).message; } })
          Button('返回').fontColor('#657460').backgroundColor('#F1F0E5').onClick(() => this.page = 'garden')
        } else { this.gardenPage() }
        if (this.message) { Text(this.message).fontSize(11).fontColor('#98745B').width('100%').padding(12).backgroundColor('#F2ECD8').borderRadius(10) }
      }.width('100%').constraintSize({ maxWidth: 780 }).padding({ left: 24, right: 24, bottom: 40 })
    }.height('100%').width('100%').backgroundColor('#F8F3E4').align(Alignment.Top)
  }
}
