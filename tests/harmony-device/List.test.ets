import { describe, it } from '@ohos/hypium';
import DeviceTestRunner from '../testrunner/DeviceTestRunner';
export default function testsuite(): void {
  describe('ClipGardenRealDevice', () => {
    it('crossDeviceNativeServices', 0, async () => {
      await new DeviceTestRunner().onRun();
    });
  });
}
