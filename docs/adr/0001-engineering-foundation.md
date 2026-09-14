# ADR 0001: 工程基础与服务边界

状态：接受（2026-09-14）

## 决策

采用 npm workspaces 的 monorepo；TypeScript 用于共享协议、API 和服务骨架，Node.js 内置 HTTP 与测试运行器保持运行时依赖最小。微信小程序与管理端作为 `apps/` 宿主边界，后续可分别接入微信原生工具链和成熟前端框架；当前不提前引入页面依赖。

`services/api` 负责认证、业务状态和副作用确认；`services/ai-parser` 只负责受控的解析能力边界，不能直接写业务状态。模型名、模型/Prompt/规则版本应随请求审计记录。`packages/protocol` 提供跨端接口，`schemas/v1/` 是 Verified Action Object 与 Action Graph 的机器权威来源，应用层不得复制。

数据存储方向是服务端数据库（开发期可用测试替身，生产由迁移管理）；原文、派生结果和审计记录分层保存，最小化收集，敏感字段脱敏，访问可追踪并设置保留期限。local/test/demo/production 使用独立配置和数据边界。

运行时协议校验采用 Ajv 2020-12 与 `ajv-formats`；它们是固定的最小 Node 运行时依赖，不重复实现 JSON Schema 验证器。构建时将 `schemas/` 和 `benchmark/schema/` 拷贝到 `dist/`，协议包根据自身模块位置定位文件，不依赖运行时 `process.cwd()`。

API 约定：每次请求接受或生成 `x-request-id`；错误统一为 `{error:{code,message,requestId,retryable}}`；默认请求超时 5 秒，客户端仅对幂等读取和明确标记 `retryable` 的错误重试；日志禁止 token、AppSecret、原文中的个人信息；带副作用的操作必须携带用户确认并在审计中记录。AI 尚未配置时返回明确 501，不返回伪造解析结果。

## 未决事项

认证方案、数据库具体产品、队列和 AI provider 在产品边界与部署约束明确后另行 ADR。
