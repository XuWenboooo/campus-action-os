# 冻结 VAO 字段核对矩阵 v1.0

依据 `docs/frozen/信息翻译器_一等奖版_冻结实验与程序目标_v1.0.md` 第 4 节逐字段核对。冻结原文未被修改；本表记录机器协议的对齐方式。

| 冻结字段               | 当前 Schema            | 对齐 | 偏差/修复方式                                                    | 修复后测试                              |
| ---------------------- | ---------------------- | ---- | ---------------------------------------------------------------- | --------------------------------------- |
| `action_id`            | `action_id`            | 是   | 保留稳定标识与格式约束                                           | Schema 正例/反例                        |
| `document_id`          | `document_id`          | 是   | 从旧 `source_document_id` 迁移；旧名被拒绝                       | `test_old_names_and_enums_are_rejected` |
| `title`                | `title`                | 是   | 必填非空                                                         | 每字段 required 测试                    |
| `target_population[]`  | `target_population[]`  | 是   | 直接数组；状态由 `field_status` 表达                             | 正例与证据测试                          |
| `user_relevance`       | `user_relevance`       | 是   | `relevant / irrelevant / uncertain`；旧 `not_relevant` 被拒绝    | 枚举反例与证据测试                      |
| `relevance_reason`     | `relevance_reason`     | 是   | 独立可解释文本；证据绑定到 relevance/target_population           | 正例测试                                |
| `action_type`          | `action_type`          | 是   | 必填非空字符串                                                   | 每字段 required 测试                    |
| `steps[]`              | `steps[]`              | 是   | 步骤含证据与 epistemic 状态                                      | 正例、缺证据反例                        |
| `dependencies[]`       | `dependencies[]`       | 是   | 关系枚举统一为英文 `postpones/revokes/replaces` 等               | Schema 与 Graph 测试                    |
| `conditions[]`         | `conditions[]`         | 是   | 至少两个 outcome；引用由运行时规则检查                           | Schema 正例                             |
| `exceptions[]`         | `exceptions[]`         | 是   | 例外独立建模，不降为备注                                         | Schema 正例                             |
| `deadline`             | `deadline`             | 是   | ISO 值或 JSON `null`；精度恢复为 `minute/hour/day/range/unknown` | null、字符串 null、精度测试             |
| `location`             | `location`             | 是   | Claim 或 null，字段级状态与证据分离                              | explicit 无证据测试                     |
| `platform`             | `platform`             | 是   | Claim 或 null，未猜测时 unknown                                  | explicit 无证据测试                     |
| `entry_link`           | `entry_link`           | 是   | Claim 或 null                                                    | 每字段 required 测试                    |
| `required_materials[]` | `required_materials[]` | 是   | 材料对象含证据与 epistemic 状态                                  | 正例与字段测试                          |
| `consequence`          | `consequence`          | 是   | Claim 或 null                                                    | 每字段 required 测试                    |
| `obligation`           | `obligation`           | 是   | `mandatory/recommended/informational/unknown`                    | Schema 枚举                             |
| `evidence[]`           | `evidence[]`           | 是   | 字段名覆盖所有关键字段；坐标 0–1                                 | Schema 与运行时验证                     |
| `confidence`           | `confidence`           | 是   | score 允许闭区间 0–1，无默认值                                   | zero confidence 测试                    |
| `epistemic_status`     | `epistemic_status`     | 是   | `explicit/rule_inferred/ai_estimated/unknown`                    | 枚举测试                                |
| `verification_status`  | `verification_status`  | 是   | `passed/conflict/user_confirmation_required`；不承载阶段         | 状态测试                                |
| `task_status`          | `task_status`          | 是   | `pending/in_progress/completed/expired/cancelled`                | 枚举测试                                |
| `change_history[]`     | `change_history[]`     | 是   | 追加式变更；延期/撤销/替换与 Graph 关系同名                      | Schema 正例                             |

增强字段 `field_status` 与 `result_stage` 不替代冻结字段：前者为关键字段证据/认识状态索引，后者独立表达模型输出、规则复核、用户确认阶段。`summary`、Claim 元数据和审计字段属于可追溯增强。

结论：冻结字段和枚举已在机器协议中逐项覆盖；旧语义只作为明确失败的迁移反例保留。
