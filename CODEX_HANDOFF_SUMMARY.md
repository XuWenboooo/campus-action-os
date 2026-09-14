# Campus Action OS / 信息翻译器
## Foundation 阶段最终 Handoff

状态：Foundation 范围冻结。本文是当前阶段的最终可复现基线；后续工作必须另开 Phase 2/3/产品阶段任务，不得在本阶段继续施工。

## Frozen baseline

```text
frozen HEAD = bf7ff78c5a2e1f6b5a57452cf4056e90cc721ab7
branch = feat/engineering-foundation
tracked worktree = clean
untracked user-owned files = output/, tmp/, tools/create_collaboration_report_pdf.py, tools/create_project_plan_pdf.py
remote/push = none
```

冻结规范仍以仓库中的 `docs/frozen/信息翻译器_一等奖版_冻结实验与程序目标_v1.0.md` 及其相关冻结字段矩阵为准。未修改冻结核心 Schema 语义。

## Status decision

```text
ENGINEERING_FOUNDATION_STATUS = COMPLETE
EXTERNAL_INTEGRATION_STATUS = BLOCKED_EXTERNAL
SCIENTIFIC_VALIDATION_STATUS = BLOCKED_DATA
PRODUCT_RELEASE_STATUS = NOT_READY
FOUNDATION_PHASE = FROZEN
```

`ENGINEERING_FOUNDATION_STATUS` 只判断可运行、可测试、可审计的本地工程底座，不被 OCR_NOT_CONFIGURED、真实 provider、正式 benchmark、微信人工验证、production auth、reminder service、production deployment、真实试点或完整账号删除否决。

## 已完成能力

- 公共 Draft 2020-12 Schema、TypeScript 类型和运行时契约校验；包含统一错误对象、版本、请求身份和导出契约。
- SQLite migration、外键、索引、Repository、持久化和状态机；迁移可重复执行，当前验证为 23 张核心表。
- 真实的 `Document → ParseJob → VerifiedActionObject → Confirm → Task` SQLite 闭环，包含 Action Graph、步骤、依赖、截止时间、材料和证据落库。
- 文本标准化、受控 OCR 接口、规则解析、用户相关性、时间/条件/材料解析、证据对齐、Error Shield、置信/拒答和人工确认边界。
- `requestId`、解析幂等、非法状态拒绝、失败路径、超时、协议拒绝、证据不在原文、跨文档身份冲突、事务回滚和 parser outage 持久化。
- API 端点和 OpenAPI 结构校验；副作用操作保留显式用户确认边界；当前用户数据导出经过 Schema 验证并包含媒体完整性检查。
- 30 条 `data_origin=synthetic`、`benchmark_status=development_only` 通知夹具及 evaluation harness；失败和拒答计入分母。
- Windows PowerShell 启动验证：SQLite API、rule-based AI 和 parse chain 可在本地成功完成。

## 自动验证证据

以下命令均在 frozen HEAD 上重新执行并通过：

```text
git status --short                         PASS; tracked clean
git rev-parse HEAD                         PASS; bf7ff78c5a2e1f6b5a57452cf4056e90cc721ab7
git log --oneline -10                      PASS
git diff --check                           PASS
npm.cmd run check                          PASS; 52/52 Node tests, Python 55+5+6, typecheck, format/lint, build, OpenAPI, secret scan, manifests
npm.cmd run test:e2e                       PASS; 18/18
npm.cmd run test:db                        PASS; 4/4
npm.cmd run evaluate:fixtures              PASS; 30 development-only samples
npm.cmd run start:verify                   PASS; 23 tables, API=sqlite, AI=rule-based, parse_chain=succeeded
```

`npm.cmd run check` 的 miniapp 静态检查通过，但保留 `MANUAL_VERIFICATION_REQUIRED`，没有冒充微信开发者工具运行通过。

## DEV_ONLY_METRICS

来自 `npm.cmd run evaluate:fixtures` 的 30 条 synthetic development-only 样本：

```text
action_precision = 1
action_recall = 1
action_f1 = 1
deadline_exact_match = 1
relevance_accuracy = 1
material_annotated_count = 2
material_precision = 1
material_recall = 1
material_f1 = 1
evidence_coverage = 1
evidence_span_annotated_count = 30
evidence_span_precision = 1
evidence_span_recall = 1
evidence_span_f1 = 1
critical_error_rate = 0
unsupported_critical_claim_rate = 0
```

这些数字只证明开发夹具和 harness 的可运行性，不代表正式 800 条 CampusActionBench 结果，不得据此继续优化 parser 或规则，也不得作为生产质量承诺。

## 已知限制与 blockers

### External blockers

- 真实 OCR/provider 尚未接入；默认媒体路径为 `OCR_NOT_CONFIGURED`，现有通过项只覆盖受控注入 OCR 和 rule-based AI。
- 微信开发者工具中的页面、登录、上传、确认、任务和隐私运行验证仍需外部工具与设备环境。
- provider 凭据、生产网络、生产部署环境和外部服务不在本阶段范围内；本阶段未访问生产服务、未使用真实密钥或真实用户数据。

因此：`EXTERNAL_INTEGRATION_STATUS = BLOCKED_EXTERNAL`。

### Scientific blockers

- 正式 CampusActionBench 800 条数据（480/160/160）尚不存在于当前验证范围。
- 授权记录、双人独立标注、仲裁记录、gold evidence spans 和正式冻结 manifest 尚未具备。
- 当前 30 条夹具明确为 `development-only`，不能替代正式科研验证。

因此：`SCIENTIFIC_VALIDATION_STATUS = BLOCKED_DATA`。

### Product backlog（仅记录，不在 Foundation 实施）

- production authentication/session、真实 reminder scheduling/sending、部署、监控、回滚和真实用户试点。
- 完整账号/个人数据删除、保留期限和运营支持流程。
- 真实 OCR/provider adapter 及其非生产凭据、限流、超时、隐私和故障演练。
- 微信开发者工具人工验收清单的实际执行。
- M2 adapter harness 当前保持 pending；它不是产品持久化实现，也未被计作通过。

因此：`PRODUCT_RELEASE_STATUS = NOT_READY`。上述项目均未在本阶段实施。

## 下一阶段 entry conditions

### Phase 2 — OCR / Provider Integration

- 明确 provider adapter 合同、输入输出保留策略、超时/重试/降级和隐私边界。
- 提供经批准的非生产 sandbox/凭据与网络环境，并保持真实 provider 结果与 rule-based/synthetic 结果可区分。
- 完成媒体样本、OCR 质量门槛、失败演练和微信开发者工具人工验证安排。

### Phase 3 — CampusActionBench-800 Scientific Validation

- 获得可审计的数据授权和 480/160/160 split 冻结输入。
- 完成标注指南、两名独立标注者、仲裁流程、gold evidence spans、lineage 和 SHA-256 manifest。
- 固定 parser/provider/prompt/rule/code 版本，正式运行 evaluator，并发布逐样本错误报告和正式指标。

### Product Release

- production auth、reminder service、部署目标、监控/回滚、数据删除与保留策略全部通过安全和运维验收。
- 微信端人工验收完成；关键副作用继续要求明确用户确认。
- 小范围真实试点获得授权、支持流程、停止条件和回滚方案。

本文件更新后只允许进行状态复核；发现的新改进点只能追加到上述 backlog，不得在 Foundation 范围实施。
