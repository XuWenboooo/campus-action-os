# Progress

## 2026-09-14

- 实际 HEAD 从 `87e7ee7` 重新核验后整合已有冻结协议基础，形成提交 `d5d2783`。
- 完成 UserProfile、Document、ParseJob、Task、NotificationRevision、Error 的公共 v1 Schema 与 AJV 运行时校验。
- 完成 Node 26 `node:sqlite` 迁移与 Repository，包含外键、索引、事务、状态机、审计、幂等和通知修订历史。
- 完成 rule-based parser HTTP 服务、字段级 Evidence、Action Graph、Critical Error Shield 和失败/拒答路径。
- API E2E 已覆盖 SQLite 中的 Document → ParseJob → VerifiedActionObject → 用户确认 → Task；30 条合成通知评测可运行。
- 评测报告补齐 Material F1、Evidence Span F1（无金标准时明确为 null）、逐样本错误码和 Error Shield 原始错误记录；Repository 增加文件 SQLite 关闭/重开持久化验证。
- 增加 HTML 文本标准化，以及图片/PDF 的显式 `OCR_NOT_CONFIGURED` 降级路径和测试；未把未配置 OCR 伪装为成功。

仍为 `NOT_READY`：真实 OCR/provider、正式 800 条冻结评测、微信开发者工具人工验证、真实认证/提醒和生产部署均缺失；本地测试不能替代这些证据。
