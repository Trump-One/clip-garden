# 首版验证记录

时间：2026-10-20（Asia/Shanghai）。

- Node.js 24 自动测试：14 项通过，覆盖密码登录 / 会话撤销、双客户端文字和图片同步、置顶与 tombstone、游客隔离和显式迁移、请求幂等与冲突、离线 outbox，以及 Web / 原生华为授权码服务端校验。
- macOS ARM64：生成 DMG/ZIP，已启动应用；通过界面验证游客新增记录和置顶。
- Windows x64：生成 NSIS EXE；GitHub Windows runner 亦构建成功；未在 Windows 真机完成使用验收。
- HarmonyOS：API 26.0.0 编译成功。已为本应用创建本机调试签名，并通过 HDC 安装至连接的 Mate 80 Pro Max / HarmonyOS 7；安装返回 `install bundle successfully`。用户已在真机打开并确认可正常进入花园主页；随后已完成真机原生服务的 7 项检查和桌面端 5 项结果核对，见 [详细测试记录](testing.md)。
- 本机账号 / 同步 API 已启动，`/health` 返回 `ok: true`。
- 建立 HDC USB 反向端口：设备 `127.0.0.1:4318` → 开发电脑 `127.0.0.1:4318`。手机客户端可填写 `http://127.0.0.1:4318`；连接断开后该通路失效，同局域网可改用电脑 IP。
- 华为后台已创建独立 HarmonyOS 应用并保存本机 OAuth 回调。Account Kit 原生授权代码通过 ArkTS 编译，scope 只申请 `profile`，不申请手机号。真实授权仍待服务端 Client Secret、与新包名匹配的 DevEco 签名 Profile、真机授权流程验收。

GitHub 自动测试 / 打包：[首轮成功记录](https://github.com/Trump-One/clip-garden/actions/runs/39365285804)。

公开 Git 不含签名配置、私钥、证书、设备 Profile、账号数据库或客户端本机数据。已签名的真机 HAP 含设备调试配置，只保存在本机 `release/`，不会推送到公开仓库。公开工程保留可移植的未签名构建配置。

修复版为 0.1.1。真实系统剪贴板文字 / PNG 往返已通过；新增图片删除回归测试，修复了图片 tombstone 导致批次失败和旧版剪贴板接口阻断启动定时器的问题。新包名调试签名尚未生成，因此旧版真机检查不代表当前签名包的登录验收。
