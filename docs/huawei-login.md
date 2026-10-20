# 华为账号接入状态与配置

当前实现：点击按钮，系统浏览器打开华为官方 OAuth 授权页面；浏览器已登录时复用其登录态，首次仍需用户授权。服务端交换 authorization code，再从华为获取经验证的 OpenID，创建独立账号会话。桌面和鸿蒙使用同一个 Web OAuth 客户端，所以相同华为账号具有相同身份。

当前没有实现 Account Kit 原生账号选择面板 / 免跳转系统一键登录。这是继续开发项；需在华为开发者后台确认 HarmonyOS 应用、合法的 bundleName、签名指纹和客户端配置，并在服务端通过经验证的 UnionID 或显式绑定流程与 Web 身份关联，不能直接信任客户端提交的 OpenID。

## 配置

1. 登录华为开发者后台，找到自己的应用，确认开通账号服务，并配置 Web OAuth 客户端。现有原生应用不一定自动具有 Web OAuth 权限。
2. 配置精确回调 URL，例如 `https://your-domain.example/v1/auth/huawei/callback`。如果只在本机开发，需确认华为后台允许的 localhost 回调规则；不能假定任意局域网 HTTP 地址可被接受。
3. 在服务端 `.env` 设置 `HUAWEI_CLIENT_ID`、`HUAWEI_CLIENT_SECRET`、`HUAWEI_REDIRECT_URI`。不在客户端打包 client_secret。
4. 重启服务，在三端点击「华为账号登录」，授权后返回应用。

无公网域名时，邮箱登录与局域网同步可以先用；华为登录须完成被华为接受的回调配置，或者后续接入不依赖 Web 回调的原生 Account Kit 服务端验证流程。

## 验证机制

- 服务端生成随机 state，绑定一次授权，5 分钟有效。
- 客户端轮询另用 256 位随机 pollSecret，不能靠公开 flow ID 领取会话。
- 回调和领取结果均为单次使用，拒绝错误 state / pollSecret / 重放。
- 不相信客户端声称的华为身份；以官方 token + user-info 响应为准。
- 目前仅用模拟华为响应验证状态机，真实应用凭据和真实授权尚未联调。

官方资料：[HarmonyOS Account Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-atomic-service/atomic-account-development)、[授权码应在服务端换取 Token](https://developer.huawei.com/consumer/cn/codelab/HMSAccounts-HarmonyOS-JavaScript/)、[原生 Huawei ID 授权流程](https://developer.huawei.com/consumer/en/doc/harmonyos-guides/account-get-phonenumber)。
