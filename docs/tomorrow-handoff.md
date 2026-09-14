# Handoff

当前工作树包含用户生成且未跟踪的 `output/`、`tmp/` 和 `tools/create_*_pdf.py`，不要删除或提交。工程代码已完成本地 SQLite/AI/API 文本闭环，并补充了评测指标、文件持久化验证、HTML 标准化、图片/PDF 的明确 OCR 降级、条件 Action Graph 分支、通知修订到既有 Task 的待确认同步、学生端同步提示、100 轮稳定性 E2E、跨文档 Evidence 主键修复、多阶段截止绑定、来源元数据拒绝和 PATCH 幂等保护，下一轮优先：

1. 继续覆盖多阶段图的真实业务语义，并为通知同步增加更完整的用户界面提示；
2. 接入受控、可审计的 OCR/版面解析实现，并保持无凭据 provider 为 `OCR_NOT_CONFIGURED`；
3. 按 `docs/manual-wechat-verification.md` 在微信开发者工具执行人工验收后才能更新为 PASS；
4. 执行完整 `npm.cmd run check`、PowerShell 启动验证和干净工作树审计。
