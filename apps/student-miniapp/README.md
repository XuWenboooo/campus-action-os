# Student mini-program boundary

微信小程序宿主目录。这里提供本地开发用的原生最小页面和 API client；页面、AppSecret 和模型密钥尚未接入，客户端只允许调用 API 服务。

导入项目后请把 `app.js` 中的 `apiBaseUrl` 指向开发机可访问地址。微信开发者工具运行、设备兼容性、网络配置和页面交互仍必须按 `docs/manual-wechat-verification.md` 人工验证，当前状态是 `MANUAL_VERIFICATION_REQUIRED`。

当前前端 MVP 默认开启 `app.js` 的 `globalData.useMock`，可独立演示 Action Center → Import → Parsing → Action Result → Evidence → Task Detail 以及 Notification Diff 全链路。Mock 状态保存在微信本地存储中；接入真实服务时将该开关关闭，页面仍通过 `utils/api.js` 的统一 adapter 调用后端。

Demo 状态支持 `BASELINE`、`DEMO_A`、`DEMO_B`、`DEMO_C` 隔离；开发验收可调用 `utils/api.js` 的 `resetDemoState()` 重置为仅含普通任务的基线，进入 Demo C 时才会注入延期通知对应的旧任务。

`src/protocol.ts` 是客户端与共享协议包的唯一边界；它不在小程序包内保存模型服务密钥。
