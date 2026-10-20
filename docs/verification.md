# 首版验证记录

时间：2026-10-20（Asia/Shanghai）。

- Node.js 24 集成测试：8 项通过，覆盖密码登录 / 会话撤销、双客户端文字和图片同步、置顶与 tombstone、游客隔离和显式迁移、请求幂等与冲突、离线 outbox、未配置华为凭据的明确错误、模拟华为回调状态验证和重放拒绝。
- macOS ARM64：生成 DMG/ZIP，已启动应用；通过界面验证游客新增记录和置顶。
- Windows x64：生成 NSIS EXE；GitHub Windows runner 亦构建成功；未在 Windows 真机完成使用验收。
- HarmonyOS：API 26.0.0 编译成功。已为本应用创建本机调试签名，并通过 HDC 安装至连接的 Mate 80 Pro Max / HarmonyOS 7；安装返回 `install bundle successfully`。启动、交互和手机到服务端同步需继续真机验收。
- 本机账号 / 同步 API 已启动，`/health` 返回 `ok: true`。
- 建立 HDC USB 反向端口：设备 `127.0.0.1:4318` → 开发电脑 `127.0.0.1:4318`。手机客户端可填写 `http://127.0.0.1:4318`；连接断开后该通路失效，同局域网可改用电脑 IP。
- 华为真实账号：尚未配置客户端凭据 / 合法回调，未进行真实授权验收。当前仅有 Web OAuth 实现，原生 Account Kit 一键登录尚未接入。

GitHub 自动测试 / 打包：[首轮成功记录](https://github.com/Trump-One/clip-garden/actions/runs/39365285804)。

公开 Git 不含签名配置、私钥、证书、设备 Profile、账号数据库或客户端本机数据。已签名的真机 HAP 含设备调试配置，只保存在本机 `release/`，不会推送到公开仓库。公开工程保留可移植的未签名构建配置。
