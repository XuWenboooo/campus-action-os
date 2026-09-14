# M1 集成验收记录

状态：PASS（截至 2026-09-14；远程 CI run `34809082935` 已通过，`main` 已快进封板，`m1-foundation-v1.0.0` 已创建）

## 集成内容

- 工程地基：`87e7ee7cc78ec94db18e806f5bf07a0906dc1819`
- 核心协议：`266dca6d45a152240e27775669589cbd40a63ca5`
- CampusActionBench：`6100ad9541d66c1cd1645cc034ff0a306e8dd1be`
- 冻结方案：`docs/frozen/信息翻译器_一等奖版_冻结实验与程序目标_v1.0.md`
- 冻结方案 SHA-256：`F17072D340314E5C4A01B13B1D017F8ABF35ECCDF9C60D3995380FCD776E712D`
- 产品协议版本：`verified-action-object/v1`、`action-graph/v1`；TypeScript 包版本：`1.0.0`
- Benchmark Schema：CampusActionBench v1（保留其原生枚举；协议仅通过可选 `gold.protocol_projection` 适配，不复制协议字段）

## 已实现

monorepo 工程配置、Node/Python 依赖入口、共享协议包、明确 TypeScript 类型、Ajv 2020-12 运行时校验、构建后 Schema 加载、API/AI 服务健康边界、统一 CI、协议/Benchmark 兼容映射、开发样例审计和敏感信息门禁。

## 未实现

正式 800 条数据、正式测试集冻结、AI 解析、真实模型/Prompt/规则、微信小程序业务、发布端业务、数据库、认证、正式实验、真实试点，以及任何用户/效果指标。

## 验证命令与结果

- `npm ci`：通过。
- `python -m pip install -r requirements-dev.txt`：依赖清单可安装；CI 使用 Python 3.12。
- `npm run check`：通过。
- Node 单元测试：4 passed。
- Python contracts：53 passed。
- Python Benchmark unittest：4 passed。
- Python 集成 Schema/兼容测试：6 passed。
- 开发样例 audit：通过，2 条样例；类别比例超生产门槛仅作为 development warning。
- 三份 JSON Schema 离线加载和 Draft 2020-12 检查：通过。
- Python 语法检查、敏感信息扫描、`git diff --check`：通过。
- API `/health`、`/v1/capabilities` 和请求 ID 错误响应：通过；AI 未配置时返回 501，不伪造结果。
- 远程 GitHub Actions CI：run `34808501085` 通过（[workflow run](https://github.com/XuWenboooo/campus-action-os/actions/runs/34808501085)）。

## M2 稳定接口与风险

M2 可依赖 `packages/protocol` 的协议版本、明确类型、`loadSchema`/`getSchemaPath`、`validateVerifiedActionObject`、`validateActionGraph` 和标准错误结果；服务边界为 `services/api` 与 `services/ai-parser`。Schema 字段级语义以冻结原文和已对齐的 `schemas/v1/` 为准；不能在应用层复制第二套对象。正式数据授权、认证/数据库选型、AI provider、远程 CI 和部署隔离仍是进入生产前风险。

结论：满足“协议与数据冻结”到“端到端工程闭环”之间的工程进入条件，可供 M2 开发使用；不代表 M2 功能或正式实验已经完成。M1 远程 CI、`main` 封板和不可变发布标签均已完成。
