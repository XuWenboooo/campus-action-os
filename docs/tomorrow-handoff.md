# Handoff

当前工作树包含用户生成且未跟踪的 `output/`、`tmp/` 和 `tools/create_*_pdf.py`，不要删除或提交。工程代码已完成本地 SQLite/AI/API 文本闭环，并补充了评测指标、文件持久化验证、HTML 标准化和图片/PDF 的明确 OCR 降级，下一轮优先：

1. 增加多阶段 Action Graph 与通知变更同步到既有 Task 的测试；
2. 接入受控、可审计的 OCR/版面解析接口，并保持无凭据 provider 为 `NOT_RUN_CREDENTIALS_REQUIRED`；
3. 按 `docs/manual-wechat-verification.md` 在微信开发者工具执行人工验收后才能更新为 PASS；
4. 执行完整 `npm.cmd run check`、PowerShell 启动验证和干净工作树审计。
