# Handoff

当前工作树包含用户生成且未跟踪的 `output/`、`tmp/` 和 `tools/create_*_pdf.py`，不要删除或提交。工程代码已完成本地 SQLite/AI/API 文本闭环，并补充了评测指标、文件持久化验证、HTML 标准化、PNG/JPEG/PDF 文件提取、离线 RapidOCR、ExternalProvider/FallbackPolicy、图片/PDF 的明确降级、条件 Action Graph 分支、通知修订到既有 Task 的待确认同步、学生端同步提示、100 轮稳定性 E2E、跨文档 Evidence 主键修复、多阶段截止绑定、来源元数据拒绝、所有现有 PATCH 的幂等保护、文档软删除幂等、Action/Task 状态同步与拒绝取消、Parser 拒答结果持久化、受限二进制上传持久化、共享 Error Shield 悬空引用校验、发布角色闸门、解析失败后的人工建任务回退、公共状态语义校验、完成后 Action 不可拒绝、用户 Task 截止时间覆盖保护、ParseJob 请求哈希幂等保护、开发登录角色 provision 幂等保护、Action steps/dependencies/deadlines/materials 的归一化投影持久化、标准化原文 Evidence 对齐校验、画像语义匹配、模糊时间/线上平台 Evidence、API 未知字段和任务完成确认边界校验、Action→Task 唯一活动任务和解析响应身份回环校验、学生端任务完成确认、Windows API→AI 启动链验证、二进制媒体入口收敛和 `user-data-export/v1` 隐私导出，下一轮优先：

1. 在批准的非生产 sandbox 中验证 `ExternalProvider`，保留超时、限流、取消、schema 拒绝和安全日志证据；无凭据时不得伪装为已接入；
2. 按 `docs/manual-wechat-verification.md` 在微信开发者工具执行人工验收后才能更新为 PASS；
3. 评估并补齐正式 800 条冻结评测集与 evidence span 金标准；
4. 进入产品阶段后再处理真实认证、提醒服务、部署和真实试点；
5. 变更后继续执行完整 `npm.cmd run check`、PowerShell 启动验证和干净工作树审计。
