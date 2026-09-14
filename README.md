# Campus Action OS

可信校园行动操作系统：把非结构化校园通知转换为可核验、可执行、可追踪的行动。

## 项目定位

把非结构化校园通知转换为可核验、可执行、可追踪的行动；本仓库当前只承载工程基础，不代表解析能力已经上线。

## 当前阶段

工程地基阶段：已提供 monorepo、API/AI 服务边界、共享协议接口、质量门禁和本地启动说明。benchmark、核心 Schema 与业务功能由对应协作者维护，本分支不修改它们。

## 目录

`apps/student-miniapp` 微信小程序宿主边界；`apps/admin-console` 发布/管理端边界；`services/api` 业务 API；`services/ai-parser` AI 解析服务边界；`packages/protocol` 共享请求、错误和版本接口；`docs/adr` 架构决策；`tests` 工程测试。

## 设计原则

- 字段级原文证据
- Action Graph，而非单一待办清单
- 关键不确定性必须要求用户确认
- 所有具备副作用的行为都需用户明确确认

## 环境要求

Node.js 20+、npm 10+。Windows PowerShell、macOS 和 Linux 均可使用；不要把生产密钥放入小程序或仓库。

## 安装和启动

```text
npm install
npm run check
npm run test
npm run build
npm run dev:api
```

API 默认监听 `http://localhost:3000`，可访问 `/health` 和 `/v1/capabilities`。启动 AI 服务边界使用 `npm run dev:ai`；它不会返回虚假的解析结果。

复制 `.env.example` 为 `.env.local` 仅供服务端使用。local、test、demo、production 配置和密钥管理必须分离；小程序构建上下文不读取模型密钥。

## 质量命令

`npm run format:check`、`npm run lint`、`npm run typecheck`、`npm run test`、`npm run build`，或一次运行 `npm run check`。CI 与这些命令保持一致。

## 测试层次

单元测试验证纯函数；契约测试验证共享协议与 API 错误格式；集成测试连接真实依赖的测试替身；端到端测试覆盖用户确认链路；现场演示压力测试只使用脱敏演示数据，不能替代生产容量测试。

## 分支和提交

从 `main` 创建 `feat/<topic>`、`fix/<topic>` 或 `docs/<topic>` 分支；提交使用简短的 Conventional Commits（如 `feat(api): add health endpoint`）。提交前运行 `npm run check`。本分支不合并 main。

## 尚未实现

真实通知采集、身份认证、数据库迁移、AI provider 接入、Prompt/规则编排、最终 Verified Action Object Schema、benchmark 运行器、生产部署和小程序页面均未实现。
