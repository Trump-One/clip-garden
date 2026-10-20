# 实机与系统测试（2026-10-20）

## 验证范围

- 13 项 Node 自动测试通过，包括账号隔离、双客户端同步、离线 outbox、幂等 / 冲突、图片 tombstone，以及 Electron 44 异步剪贴板适配器。
- 在连接的 Mate 80 Pro Max / HarmonyOS 7 上，通过 `aa test` 运行正式 `GardenStore` 原生服务代码，完成 7 项检查：游客本机持久化；邮箱登录与 Mac 文字 / PNG 下载及实际解码；手机新增 / 置顶上传；系统 Asset Store 会话恢复；断网保存与恢复连接上传；跨设备删除；退出后的游客 / 账号隔离。
- 测试结束后，Mac 上运行正式桌面同步客户端 `Garden` 再次拉取，验证手机新增、置顶、断网恢复记录、删除 tombstone 和游客不上传，5 项均通过。详见 [真机结果](real-device-test.json)。
- 在本机真实 Electron 44.9.1 进程中读写系统剪贴板，文字与 1024×1024 PNG 均可往返；测试结束恢复剪贴板。详见 [剪贴板结果](desktop-clipboard-test.json)。
- Mac 图形界面已验证登录、自动拉取手机新增 / 置顶 / 删除、搜索和复制按钮；实际系统剪贴板写入测试文字后，自动捕获并上传服务端，结果见 [自动捕获结果](desktop-auto-capture-test.json) 和 [同步界面](device-sync-preview.png)。测试后恢复游客模式并暂停记录。上述原生服务测试采用测试模块直接调用生产服务代码，不代表逐个界面按钮已完成穷尽测试。
- [CI 39368439469](https://github.com/Trump-One/clip-garden/actions/runs/39368439469) 的 Node 测试、Windows / macOS 真实系统剪贴板测试及安装包构建全部通过。Windows 物理电脑仍未进行人工使用验收。
- 华为真实授权和原生 Account Kit 一键登录尚未完成，不计入通过项。

## 本轮修复

1. 图片删除时内容被清空，服务端此前仍按有效 PNG 校验，导致整个同步批次失败。现在 tombstone 跳过非空图片格式校验，并有“删除图片 + 同批新增图片”回归测试。
2. Electron 44 使用异步 `clipboard.read()` / `ClipboardItem` / `Blob` 接口，旧同步接口会使启动初始化中断。现已迁移接口，串行化读写，剪贴板错误不再阻止账号同步定时器启动。

## 复现

普通测试：`node --test tests/*.test.mjs`。

真实桌面剪贴板：`pnpm test:clipboard`，需桌面会话。

真机：在仓库外准备带有效签名配置的鸿蒙工程副本，确认手机通过 HDC 连接，本机服务在 4318 端口运行：

```sh
HARMONY_SIGNED_PROJECT=/path/to/private/harmony-copy pnpm test:harmony-device
```

脚本会创建临时测试账号和隔离的 Preferences / Asset Store 空间，在手机运行测试模块，再由桌面客户端检查收敛结果。凭据只写入私有工程内生成的测试配置，不进入公开 Git；默认日志在 Git 忽略的 `work/` 下。固定回传地址是设备 USB 的 `127.0.0.1:4318`；仅支持该测试端口，其他地址需自行调整路由。

`HARMONY_SIGNED_PROJECT` 不允许位于公开源码仓库内，避免误提交证书、Profile 或生成的测试凭据。测试模块留在调试应用中，普通 release 包不包含它。
