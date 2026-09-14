# Campus Action OS 核心协议 v1

本目录定义两个共享语义的对象：Verified Action Object（VAO）和 Action Graph。机器可读规范位于 `schemas/v1/`，示例位于 `examples/`，可执行规则测试位于 `tests/contracts/`。

## 范围与冻结边界

冻结实验方案原文已以不可改写副本纳入 `docs/frozen/`，其中的实验问题、阈值、对照组和测试规则以冻结文件为准；本文件只定义实现契约。冻结方案与机器协议的字段映射见 `docs/protocol-benchmark-compatibility.md`，任何语义变更必须通过新的 `proposals/` 版本评审，不直接重写 v1 语义。

## VAO 生命周期

对象必须区分结果阶段与核验状态：

1. `result_stage=model_output`：模型首次输出；只可依据输入文本或 OCR 证据，推测必须标为 `ai_estimated`。
2. `result_stage=rule_reviewed`：规则复核后的对象；规则可拒绝缺证据、冲突、悬空引用、循环图或不一致状态，但不能把推断升级为原文明示。
3. `result_stage=user_confirmed`：用户明确确认后的对象；确认动作应进入 `change_history`，且不会改变原始证据。

`verification_status` 只能是 `passed`、`conflict` 或 `user_confirmation_required`，表示可否安全使用，而不是结果阶段。`task_status` 只能是 `pending`、`in_progress`、`completed`、`expired` 或 `cancelled`。

## 字段语义

- `user_relevance` 只能是 `relevant`、`irrelevant` 或 `uncertain`；`relevance_reason` 必须可解释，相关证据通过 `evidence.field_name` 绑定。
- `target_population[]` 是原文明确或安全推断的人群标签。多人群路径应在 Graph 节点用 `population_groups` 分开，而不是复制或覆盖 VAO。
- `steps` 是可执行动作，至少一个；`dependencies` 只表达步骤之间的关系。`conditions` 是至少两个结果的分支；`exceptions` 表达例外，不是普通备注。
- `deadline.value` 使用 ISO 日期、带时区的 datetime 或 `start/end` 日期范围。未知时只能使用真正的 JSON `null` 与 `precision:"unknown"`；不得使用字符串 `"null"`、空字符串、0 或占位日期。`boundary_semantics` 为 `before`、`no_later_than`、`on`、`after` 或 `unknown`。多阶段截止应使用多个 VAO 或 Graph milestone 节点。
- `evidence.source_text` 必须是可复核的原文片段；`page_or_image` 是页码或图像标识；`bounding_box` 使用 0 到 1 的 `[x_min,y_min,x_max,y_max]` 归一化坐标；`field_name` 限定到关键字段。OCR 缺损应保留可见文本并将相关字段标为 `unknown` 或触发 `user_confirmation_required`，不得静默修复。
- `confidence.score` 是 [0,1] 的可比较分数，不是概率真值；0 表示没有可用置信度，1 表示在当前证据范围内最高分。`basis` 记录模型、规则复核或用户确认来源。没有默认分数。
- `epistemic_status` 的 `explicit` 只适用于证据直接表达；`rule_inferred` 必须能追溯到证据但不是原文直述；`ai_estimated` 表示模型估计；`unknown` 表示缺失。冲突和需确认使用 `verification_status`。
- `change_history` 是追加式、不可变审计轨迹。延期、撤销、替换使用 `postponed`、`revoked`、`replaced` 事件，并在 Graph 中用 `postpones`、`revokes`、`replaces` 边。

关键字段为相关性、行动步骤、截止时间、材料、地点/平台、条件和例外。每个关键断言必须引用 `evidence_ids`；缺少证据不能标 `explicit`。冲突或歧义必须进入 `conflict` 或 `user_confirmation_required`。AI 生成的默认地点、材料和截止时间禁止写入协议。

## Action Graph

节点类型是 `action`、`precondition`、`decision`、`milestone`、`notice_revision`。边类型是：`blocks`（阻塞）、`requires`（前置要求）、`informs`（信息依赖）、`branches_to`（条件分支）、`alternative_to`、`postpones`、`revokes`、`replaces`。边端点必须存在；`branches_to` 必须有 `condition_id`。

多人群路径用节点的 `population_groups` 表达。同一行动若对不同人群的步骤或截止时间不同，应使用不同节点和显式分支。依赖检测对 `blocks`、`requires`、`branches_to`、`postpones`、`replaces` 构建有向图并拒绝任何有向环；`informs` 和 `alternative_to` 不作为执行阻塞环，但仍必须无悬空端点。

无法确定时的安全表达是：保留 `value:null` 或空证据数组、把状态写为 `unknown`/`conflict`/`user_confirmation_required`，并禁止下游自动创建或执行有副作用的任务。安全表达不是补全。

## 兼容与版本

`schema_version` 固定为 `.../v1`。新增可选字段属于向后兼容；改变枚举、必填字段、字段含义或时间边界必须升 v2。读取器必须拒绝未知 major version，允许记录并忽略已知 minor 扩展。字段删除、重命名或语义迁移必须保留显式转换器和变更记录。没有默认值：缺失、`null`、空数组各自有语义，读取器不得互换。

## 上下游用法

发布端创建带证据的模型输出；规则复核服务执行 Schema、证据覆盖、引用、状态机和图检测；数据库以 `action_id`、`change_history` 和 `document_id` 保存版本；学生端只把 `result_stage=user_confirmed` 或满足产品安全策略的 `result_stage=rule_reviewed` 对象转为任务；评测按三个结果阶段分别统计，不把用户确认后的修订混入模型首次输出指标。
