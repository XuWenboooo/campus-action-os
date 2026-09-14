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
- 将 `/documents/upload` 从文本别名升级为受限二进制入口：图片/PDF Base64 与文档记录在 SQLite 同一事务中保存，重开数据库后仍可取回原始字节，并传入受控 OCR Provider；未配置 Provider 仍明确失败。
- 加强共享 Error Shield 与协议语义校验：拒绝未知精度却带值的截止时间、冲突行动的 active/completed 状态、悬空 Evidence/步骤/条件/依赖引用、重复 Evidence ID、显式空地点/平台及响应图谱与行动集合不一致。
- 为二进制入口增加 PNG/PDF magic-byte 校验，避免仅凭请求 MIME 声明接受错误格式。
- 收紧双向发布权限：通知创建要求 `publisher`/`admin` 角色，开发环境只能通过显式 `dev-login` 角色选择 provision；未授权学生请求返回统一 `FORBIDDEN`。
- 补齐解析失败回退：保留原始 Document，新增要求显式确认的 `/tasks/manual`，以用户输入证据创建 `manual_task` 和 pending Task，并覆盖幂等重放/冲突、requestId、审计和后续状态机。
- 学生端导入页接入 PNG/PDF 选择、受限 Base64 上传和解析失败人工建任务；解析结果页也提供同一回退入口，未把失败状态伪装为成功。
- 本轮完整 `npm.cmd run check`、API/E2E、数据库、夹具/评估和 PowerShell 启动验证均通过；评估阈值与微信人工验收状态仍如实保留为未达成。
- 收紧用户画像 PATCH 契约：现在要求 scoped `Idempotency-Key`，重放不重复写入，key 冲突返回统一 409，并追加 `profile.updated` 审计事件；小程序客户端已同步携带幂等键。
- 加强公共状态语义校验：ParseJob 的处理中/完成/失败状态与 result/error 必须一致，Task 的 completed_at 只允许出现在 completed 状态，非草稿通知 revision 必须有 published_at；新增契约失败测试。
- 补齐文档软删除的幂等保护：删除现在要求 `Idempotency-Key` 与确认，重放不重复执行，key 冲突统一返回 409，并纳入 API/OpenAPI 回归测试。
- 修复 Action/Task 状态一致性：编辑带有活动 Task 的 Action 会事务内同步标题/截止时间；拒绝已有 Action 会取消关联的 pending/in_progress Task，并记录 Task 事件与审计。
- 修复协议级 Parser 拒答持久化：`rejected` 响应写入 failed ParseJob 时同时保留原始 result 和 `PARSER_REJECTED` error，读取不会触发状态语义损坏。
- 收紧 Action/Task 状态机边界：已完成 Task 对应的 Action 不得再次拒绝；Action PATCH 只同步本次明确修改的标题/截止时间，保留用户对 Task 截止时间的独立覆盖，并加入 API 回归断言。
- 补齐解析请求幂等一致性：新增 SQLite 迁移保存 ParseJob 的内部 `request_hash`，同一用户/文档/key 携带不同解析请求体时统一返回 `IDEMPOTENCY_CONFLICT`，并加入 API 回归测试。
- 为开发登录角色 provision 增加 scoped 幂等：同一 key 重放不重复写角色审计，修改请求体统一返回 `IDEMPOTENCY_CONFLICT`，并覆盖 API 回归测试。

仍为 `NOT_READY`：真实 OCR/provider、正式 800 条冻结评测、微信开发者工具人工验证、真实认证/提醒和生产部署均缺失；本地测试不能替代这些证据。
