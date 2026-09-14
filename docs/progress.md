# Progress

## 2026-09-14

- 实际 HEAD 从 `87e7ee7` 重新核验后整合已有冻结协议基础，形成提交 `d5d2783`。
- 完成 UserProfile、Document、ParseJob、Task、NotificationRevision、Error 的公共 v1 Schema 与 AJV 运行时校验。
- 完成 Node 26 `node:sqlite` 迁移与 Repository，包含外键、索引、事务、状态机、审计、幂等和通知修订历史。
- 完成 rule-based parser HTTP 服务、字段级 Evidence、Action Graph、Critical Error Shield 和失败/拒答路径。
- API E2E 已覆盖 SQLite 中的 Document → ParseJob → VerifiedActionObject → 用户确认 → Task；30 条合成通知评测可运行。
- 评测报告补齐 Material F1、Evidence Span F1（无金标准时明确为 null）、逐样本错误码和 Error Shield 原始错误记录；Repository 增加文件 SQLite 关闭/重开持久化验证。
- 增加 HTML 文本标准化，以及图片/PDF 的显式 `OCR_NOT_CONFIGURED` 降级路径和测试；未把未配置 OCR 伪装为成功。
- 增加 parser AbortSignal 超时、`PARSER_TIMEOUT` 持久化、生产环境身份认证闸门和文档删除确认测试。
- 增加可注入、可审计的 `OcrProvider` 契约；默认 provider 明确不运行，synthetic provider 仅用于测试图片/PDF 文本进入同一解析闭环。
- 补齐条件动作的 Action Graph 语义：显式条件现在生成 `decision` 节点和带 `condition_id` 的 `branches_to` 边，并加入协议校验测试。
- 增加通知修订到既有 Task 的真实 SQLite 关联与同步事件：新发布/延期/撤销只生成 `pending_review`，用户明确接受撤销后才取消未完成 Task，并覆盖 API、幂等和审计路径。
- 学生端任务页接入通知同步：可关联已发布通知、查看待确认变更并提交接受/拒绝；仍保留微信开发者工具人工验收状态。
- 增加 100 轮合成核心链路稳定性 E2E，连续覆盖 API、真实规则解析服务、SQLite、确认、Task 完成和持久化计数。
- 修复跨文档 Evidence 主键冲突：规则解析器现在使用文档作用域的全局唯一 Evidence ID；100 轮测试因此覆盖了真实重复运行缺陷。
- 补齐多阶段截止解析：按阶段顺序将独立截止行绑定到对应行动，并保持每个阶段的字段级 Evidence。
- 收紧输入来源边界：`data_origin` 只接受 `synthetic` 或 `user_provided`，未知值统一拒绝且不写入文档。
- 为 Action/Task 的 PATCH 副作用增加 scoped 幂等键和严格字段校验，重复请求不重复追加审计/状态事件，错误字段不再静默返回成功。

仍为 `NOT_READY`：真实 OCR/provider、正式 800 条冻结评测、微信开发者工具人工验证、真实认证/提醒和生产部署均缺失；本地测试不能替代这些证据。
