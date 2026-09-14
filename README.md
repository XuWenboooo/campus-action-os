# Campus Action OS

可信校园行动操作系统：把非结构化校园通知转换为可核验、可执行、可追踪的行动。

## 项目定位

把非结构化校园通知转换为可核验、可执行、可追踪的行动；本仓库当前承载可运行底座，不代表真实 AI 解析或生产上线已经完成。

## 当前阶段

可运行底座检查点：已提供冻结 v1 公共 Schema/运行时校验、Node 26 SQLite 迁移与 Repository、受限图片/PDF 二进制上传持久化、角色闸门、规则解析 HTTP 服务、Document → ParseJob → VerifiedActionObject → 用户确认 → Task 闭环、统一错误/幂等/requestId、强化 Error Shield 和 30 条合成评测。真实 OCR/provider、微信人工验证、正式 800 条评测和生产能力仍未实现。

## 目录

`apps/student-miniapp` 微信小程序宿主边界；`apps/admin-console` 发布/管理端边界；`services/api` 业务 API 与 SQLite Repository；`services/ai-parser` 规则解析服务边界；`packages/protocol` 共享协议/Schema 加载入口；`schemas/v1` 正式产品协议；`schemas/interfaces/v1` 公共接口协议；`database` 迁移；`tools/evaluation` 评测工具；`benchmark` 数据集工具与开发样例；`docs/frozen` 冻结方案原文；`tests` 工程测试。

## 设计原则

- 字段级原文证据
- Action Graph，而非单一待办清单
- 关键不确定性必须要求用户确认
- 所有具备副作用的行为都需用户明确确认

## 环境要求

Node.js 22.5+、npm 10+、Python 3.11–3.14。SQLite 使用 Node 内置 `node:sqlite`；Windows PowerShell、macOS 和 Linux 均可使用；不要把生产密钥放入小程序或仓库。

## 安装和启动

```text
npm ci
py -3 -m pip install -r requirements-dev.txt
npm run db:migrate
npm run check
npm run test
npm run build
npm run test:m2
npm run dev:mock
npm run dev:api
```

Windows PowerShell 可运行 `powershell -ExecutionPolicy Bypass -File scripts/verify-start.ps1` 验证启动；持续启动使用 `scripts/start-dev.ps1`。API 默认监听 `http://localhost:3000`，AI 默认监听 `http://localhost:3001`，可访问 `/health` 和 `/v1/capabilities`。

复制 `.env.example` 为 `.env.local` 仅供服务端使用。local、test、demo、production 配置和密钥管理必须分离；小程序构建上下文不读取模型密钥。

## 质量命令

`npm run format:check`、`npm run lint`、`npm run typecheck`、`npm run check:openapi`、`npm run test`、`npm run build`、`npm run test:built`、`npm run test:contracts`、`npm run test:benchmark`、`npm run benchmark:audit`、`npm run schema:check`、`npm run python:syntax`、`npm run scan:secrets`、`npm run release:manifest:verify`、`npm run diff:check`，或一次运行 `npm run check`。Windows 下 Python 命令由脚本自动选择 `py -3`，Unix 下选择 `python3`/`python`；CI 与 `npm run check` 保持一致。

## 测试层次

单元测试验证纯函数；契约测试验证 `schemas/v1`、共享协议和 API 错误格式；集成测试验证三份 JSON Schema 与开发样例；端到端测试覆盖用户确认链路；现场演示压力测试只使用脱敏演示数据，不能替代生产容量测试。`npm run benchmark:audit` 只审计开发样例，不代表 800 条正式数据或冻结测试集已就绪。

## 分支和提交

从 `main` 创建 `feat/<topic>`、`fix/<topic>` 或 `docs/<topic>` 分支；提交使用简短的 Conventional Commits（如 `feat(api): add health endpoint`）。提交前运行 `npm run check`。本分支不合并 main。

## 尚未实现

真实通知采集、真实身份认证、图片/PDF OCR、AI provider 接入、提醒发送、小程序页面人工验证、生产部署、正式 800 条数据、正式测试集冻结和正式实验均未实现。当前图片/PDF 仅完成受限本地字节保存与 OCR 边界接入，不代表 OCR 已运行。当前 `schemas/v1/` 是已验证的冻结 v1 机器契约；若需改变冻结定义或核心语义，必须新建版本/proposal。
