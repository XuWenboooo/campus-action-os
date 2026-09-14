# Proposal: 冻结方案与核心协议 v1 的兼容审计

状态：待协议负责人确认

## 背景

冻结原文在纳入仓库前，核心协议提交已经定义了 `schemas/v1/`。本记录只审计映射，不修改冻结原文，也不在此提案中悄悄改变现有 Schema 的语义。

## 发现

- 原文使用 `document_id`、`irrelevant`、`action_type`、`required_materials`、`location`/`platform`/`entry_link`、`consequence` 和 `obligation`；当前 VAO 使用 `source_document_id`、`not_relevant`、`materials`、`location_or_platform`，并未提供其余字段。
- 原文 deadline 精度为 `minute/hour/day/range/unknown`、边界为 `before/no_later_than/on/after/unknown`；当前 Schema 使用 `date/datetime/date_range/relative/unknown` 和 `inclusive/exclusive/unknown`。
- 原文 verification 状态为 `passed/conflict/user_confirmation_required`，当前协议额外区分 `model_output/rule_reviewed/user_confirmed/rejected`；这不能把模型输出、规则复核和用户确认混为一谈。
- Benchmark `gold.relevance` 只有 `relevant/not_relevant/uncertain`，没有承载 `conflict` 或 `user_confirmation_required` 的同名枚举；其 `field_evidence` 使用 OCR 半开区间，而 VAO `evidence` 使用字段证据对象。Benchmark 的 `annotation` 是标注治理元数据，不是协议 verification 状态。

## 处理

当前机器协议继续以 `schemas/v1/` 为权威；Benchmark 通过映射文档承载标准答案投影和额外数据治理字段，不复制或重定义 VAO 语义。出现冲突/需确认的 Benchmark 样本使用 `gold.ambiguities`、`gold.conflicts` 和 `gold.missing_information`，由转换器映射到协议状态，不能把 `annotation.adjudication_status` 当作用户确认。

如果产品要把冻结原文字段直接纳入机器协议，应先新建 v2 proposal，给出双向转换、损失字段和迁移测试；不得修改冻结 v1.0 或在应用层添加第二套对象。
