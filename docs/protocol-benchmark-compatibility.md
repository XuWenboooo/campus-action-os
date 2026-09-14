# 核心协议与 CampusActionBench 兼容说明

## 权威与版本

`schemas/v1/verified-action-object.schema.json` 和 `schemas/v1/action-graph.schema.json` 是正式产品协议的唯一机器可读来源，当前版本标识分别为 `verified-action-object/v1` 与 `action-graph/v1`。`benchmark/schema/campus-action-bench-v1.schema.json` 是数据集样本容器，版本为 CampusActionBench v1；它不是产品对象 Schema，也不覆盖产品字段定义。

## 映射规则

| 产品协议                  | Benchmark 标注                             | 处理                                                                                                                                                                                                                            |
| ------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user_relevance`          | `gold.relevance`                           | Benchmark 原生枚举 `relevant`、`not_relevant`、`uncertain` 保持不变；适配器只在产品边界映射 `not_relevant` → `irrelevant`；`conflict` 和 `user_confirmation_required` 保留在 `gold.conflicts`/`ambiguities`，不得降级成普通枚举 |
| `evidence[]`              | `gold.field_evidence[]`                    | 产品证据对象映射为 OCR 半开区间 `[text_start,text_end)` 及字段；页码/区块/bounding box 作为附加标注，不能丢失原文证据语义                                                                                                       |
| `ActionGraph.nodes/edges` | `gold.action_graph.actions/dependencies`   | Benchmark 保存可评测的动作投影；节点类型、边类型、分支条件和变更关系按转换器映射，不能把扁平数组当作完整 Graph                                                                                                                  |
| `verification_status`     | `annotation.adjudication_status`           | 不映射。标注仲裁是数据治理，不代表 `model_output`、`rule_reviewed` 或 `user_confirmed`                                                                                                                                          |
| `unknown`/`null`          | `gold.missing_information`、空值和风险标签 | 缺失、未知、冲突各自保留；禁止以空字符串、默认日期或标注状态替换                                                                                                                                                                |

Benchmark Schema 的 `gold.protocol_projection.payload` 可离线携带协议对象的序列化投影；实际转换仍必须通过 `packages/protocol` 的版本和 Schema 加载入口。没有使用远程 `$ref`，三份 JSON Schema 均可离线加载。

## 防漂移约束

集成测试加载三份 Schema，检查协议枚举、Benchmark 标注字段和开发样例的合法性，并断言 Benchmark 不声明 `verification_status` 作为标注字段。任何需要改变产品字段含义、必填项或枚举的工作必须升版本并新增 proposal。
