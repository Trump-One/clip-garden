import { abilityDelegatorRegistry, TestRunner } from '@kit.TestKit';
import { image } from '@kit.ImageKit';
import { util } from '@kit.ArkTS';
import { GardenStore, Clip } from '../../../main/ets/services/GardenStore';
import { DeviceConfig } from './DeviceConfig';

export default class DeviceTestRunner implements TestRunner {
  onPrepare(): void {}
  private check(condition: boolean, message: string): void { if (!condition) throw new Error(message); }
  async onRun(): Promise<void> {
    const delegator = abilityDelegatorRegistry.getAbilityDelegator();
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    const ability = await delegator.getCurrentTopAbility();
    const context = ability.context;
    const passed: string[] = [];
    try {
      let phone = new GardenStore();
      await phone.init(context, DeviceConfig.storageName);
      await phone.configure(DeviceConfig.server, true);
      await phone.add(DeviceConfig.guestMarker);
      let restored = new GardenStore();
      await restored.init(context, DeviceConfig.storageName);
      this.check(restored.visible().some((x: Clip) => x.content === DeviceConfig.guestMarker), '游客记录没有在真机持久化');
      this.check(!restored.token && !restored.user.id, '游客模式产生了账号会话');
      passed.push('guest-local-persistence');
      phone = restored;
      await phone.login(DeviceConfig.email, DeviceConfig.password, false, false);
      this.check(phone.user.id.length > 0 && phone.token.length > 0, '真机登录失败');
      const seed = phone.visible().find((x: Clip) => x.content === DeviceConfig.desktopMarker);
      this.check(seed !== undefined, '未下载到 Mac 创建的文字');
      this.check(!phone.visible().some((x: Clip) => x.content === DeviceConfig.guestMarker), '游客记录未经合并就进入账号');
      const picture = phone.visible().find((x: Clip) => x.kind === 'image');
      this.check(picture !== undefined, '未下载到 Mac 创建的图片');
      const bytes = new util.Base64Helper().decodeSync((picture as Clip).content.split(',')[1]);
      const source = image.createImageSource(bytes.buffer as ArrayBuffer);
      const pixels = await source.createPixelMap();
      const info = await pixels.getImageInfo();
      this.check(info.size.width === 1024 && info.size.height === 1024, '真机图片解码尺寸不符: ' + info.size.width + 'x' + info.size.height + ', bytes=' + bytes.length);
      pixels.release(); source.release();
      passed.push('login-and-mac-to-phone-text-image-sync');
      await phone.edit((seed as Clip).id, false);
      await phone.add(DeviceConfig.phoneMarker);
      await phone.sync();
      this.check(phone.space.pending.length === 0, '真机新增/置顶未同步成功：' + phone.message);
      passed.push('phone-to-mac-add-and-pin');
      restored = new GardenStore();
      await restored.init(context, DeviceConfig.storageName);
      this.check(restored.user.id === phone.user.id && restored.token === phone.token, '系统 Asset Store 会话恢复失败');
      this.check(restored.visible().some((x: Clip) => x.content === DeviceConfig.phoneMarker), '账号记录恢复失败');
      phone = restored;
      passed.push('asset-store-session-and-account-persistence');
      phone.server = 'http://127.0.0.1:9';
      await phone.add(DeviceConfig.offlineMarker);
      await phone.sync();
      this.check(phone.space.pending.length > 0, '断网后待同步操作丢失');
      this.check(phone.visible().some((x: Clip) => x.content === DeviceConfig.offlineMarker), '断网后本机内容丢失');
      phone.server = DeviceConfig.server;
      await phone.sync();
      this.check(phone.space.pending.length === 0, '恢复连接后未上传待同步记录：' + phone.message);
      passed.push('offline-outbox-and-reconnection');
      const removal = phone.visible().find((x: Clip) => x.content === DeviceConfig.deleteMarker);
      this.check(removal !== undefined, '待删除的 Mac 记录未下载');
      await phone.edit((removal as Clip).id, true);
      await phone.sync();
      this.check(!phone.visible().some((x: Clip) => x.content === DeviceConfig.deleteMarker), '真机删除未生效');
      this.check(phone.space.pending.length === 0, '真机删除未上传');
      passed.push('phone-delete-sync');
      await phone.logout();
      this.check(!phone.token && !phone.user.id, '退出后会话未清除');
      this.check(phone.visible().some((x: Clip) => x.content === DeviceConfig.guestMarker), '退出后未恢复游客空间');
      this.check(!phone.visible().some((x: Clip) => x.content === DeviceConfig.phoneMarker), '退出后账号内容泄漏到游客');
      passed.push('logout-and-guest-account-isolation');
      await delegator.print('DEVICE_TEST_PASS ' + JSON.stringify(passed));

    } catch (e) {
      await delegator.print('DEVICE_TEST_FAIL ' + (e as Error).message + ' passed=' + JSON.stringify(passed));
      throw new Error((e as Error).message);
    }
  }
}
