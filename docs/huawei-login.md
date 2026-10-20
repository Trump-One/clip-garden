# 华为账号接入状态与配置

鸿蒙端通过 `@kit.AccountKit` 发起原生华为账号授权，申请 `profile` 和 `serviceauthcode`，不申请手机号。授权码只发送到应用服务端，由服务端用 Client ID / Client Secret 换取令牌并查询华为验证过的 OpenID。Windows/macOS 继续使用华为官方 OAuth 浏览器授权。三个端共用同一 Client ID，服务端按已验证的 OpenID 建立统一账号。

## 配置

1. 在开发者后台使用应用 `com.trumpone.clipgarden`，启用华为账号服务并配置回调 `http://127.0.0.1:4318/v1/auth/huawei/callback`。本机回调仅用于 USB 反向端口的调试；正式服务请配置 HTTPS 域名。
2. 将 HarmonyOS 调试证书 SHA-256 指纹加入该应用 OAuth 客户端。
3. 在服务端 `.env` 设置 `HUAWEI_CLIENT_ID`、`HUAWEI_CLIENT_SECRET`、`HUAWEI_REDIRECT_URI`。Client Secret 只放服务器端，不能打包进客户端或提交到 Git。
4. 重启服务。鸿蒙点击「华为账号登录」后会由 Account Kit 显示授权；桌面端在系统浏览器授权。

无公网域名时可在 USB 反向端口下验证鸿蒙登录；跨网络的 Windows/macOS 与鸿蒙同步仍需一个可访问的 HTTPS 服务地址。

## 验证机制

- 服务端生成随机 state，绑定一次授权，5 分钟有效。
- 客户端轮询另用 256 位随机 pollSecret，不能靠公开 flow ID 领取会话。
- 回调和领取结果均为单次使用，拒绝错误 state / pollSecret / 重放。
- 不相信客户端声称的华为身份；以官方 token + user-info 响应为准。
- 原生授权码由服务端兑换；不接受客户端直接提交 OpenID。
- 当前仍需以实际 Client Secret 完成真机授权联调。

官方资料：[HarmonyOS Account Kit](https://developer.huawei.com/consumer/cn/doc/doccenter-atomic-service/atomic-account-development)、[授权码应在服务端换取 Token](https://developer.huawei.com/consumer/cn/codelab/HMSAccounts-HarmonyOS-JavaScript/)、[原生 Huawei ID 授权流程](https://developer.huawei.com/consumer/en/doc/harmonyos-guides/account-get-phonenumber)。
