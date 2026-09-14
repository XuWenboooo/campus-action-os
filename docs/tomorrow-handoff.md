# Handoff

当前工作树包含用户生成且未跟踪的 `output/`、`tmp/` 和 `tools/create_*_pdf.py`，不要删除或提交。工程代码已完成本地 SQLite/AI/API 文本闭环，下一轮优先：

1. 增加多阶段 Action Graph 与通知变更同步到既有 Task 的测试；
2. 接入受控 OCR 接口，并保持无凭据 provider 为 `NOT_RUN_CREDENTIALS_REQUIRED`；
3. 建立小程序人工验证清单，使用微信开发者工具后才能更新为 PASS；
4. 执行完整 `npm.cmd run check`、PowerShell 启动验证和干净工作树审计。
