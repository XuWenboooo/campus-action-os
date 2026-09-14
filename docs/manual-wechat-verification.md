# WeChat manual verification checklist

状态：`MANUAL_VERIFICATION_REQUIRED`。当前仓库没有把微信开发者工具运行结果伪装成自动化通过。

在微信开发者工具中导入 `apps/student-miniapp` 前，先启动服务端并确认 API 与 AI 的 `/health`。人工逐项检查：

- 开发登录、用户画像读取与更新；
- 首页任务中心、通知导入、解析进度和失败提示；
- 相关性、行动卡、Evidence 原文查看与不确定字段确认；
- 用户确认后创建任务、任务详情、合法/非法状态转换和完成确认；
- 通知修订、隐私说明、错误反馈，以及断网/超时/空输入降级；
- 客户端不包含 provider 密钥，不绕过用户确认触发副作用。

每项记录微信基础库版本、设备/模拟器、API 地址、结果截图或日志和复现步骤；未实际操作前只能保留 `MANUAL_VERIFICATION_REQUIRED`。
