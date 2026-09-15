# CampusActionBench-800 Phase 3 Protocol v1

状态：`FROZEN`（协议冻结，不代表正式数据集或正式实验已经完成）

协议版本：`campus-action-bench-protocol/v1.0.0`

目标数据集：`CampusActionBench-800`
冻结日期：2026-09-15

本文件是 Phase 3 正式数据生产前的唯一人类可读协议入口。机器可读的正式数据集 manifest 约束位于 `benchmark/schema/campus-action-bench-manifest-v1.schema.json`；机器可执行的开发工具位于 `tools/benchmark/cab.py` 与 `tools/evaluation/formal-evaluator.ts`。本文件冻结后，任何语义修改必须创建新的协议版本，不得静默改写 v1。

## 1. 范围、目标与非目标

CampusActionBench-800 用于评估校园通知到证据约束行动理解的能力，不用于训练真实用户模型，不用于执行缴费、报名、提交或发送等副作用操作。目标规模固定为：

| split | 数量 | 用途 |
| --- | ---: | --- |
| train | 480 | 开发、规则和提示词训练；可反复读取 |
| dev | 160 | 开发期选择和锁定配置；可反复读取，但须记录变更 |
| test | 160 | 协议冻结、开发结束后一次性评测；禁止调参和开发驱动分析 |
| total | 800 | 正式目标总量 |

专项时间/变更鲁棒性样本可以作为独立审计集存在，但不计入 800，也不得与三份 split 合并报告。

以下内容不属于本轮：正式收集、正式标注、模型训练、正式 test 评测、真实用户试点和生产部署。当前仓库的 30 条通知仍是 `development-only synthetic fixtures`，禁止进入正式结果表。

## 2. Dataset specification

### 2.1 样本单位

一条样本是一份通知原件或通知版本与一个明确的校园用户画像的配对。转发、截图裁剪、OCR 版本、附件页、修订稿和撤销稿只要来自同一通知谱系，就使用同一个 `source_group`。同一通知可以与不同画像形成多个样本，但必须在同一 split 内并在 manifest 中登记配对关系。

每条正式记录使用 UTF-8 JSONL，至少包含：

- `sample_id`、`source_group`、`provenance`（来源、授权、`data_origin`）；
- `raw_input`（原始输入类型、逐字保留的 OCR/标准化文本、页/块布局）；
- `user_profile`（明确的非真实身份画像）；
- `gold`（相关性、行动图、截止时间、材料、条件、例外、冲突、缺失信息、风险标签和字段证据）；
- `annotation`（两名独立标注员、独立结果哈希、仲裁状态和仲裁记录）；
- `data_version`、`change_history`。

协议容器不得复制或重定义产品 VAO/Action Graph 的字段语义。需要保存产品投影时，使用 `gold.protocol_projection`，并由产品 Schema 另行校验。

### 2.2 来源与隐私

正式来源只能是经授权的真实通知或经授权、保留任务语义的重构样本；每条记录必须有可审计的 `authorization_record_id`。`data_origin=synthetic` 只能用于开发 dry-run，不得补齐正式 800。

原文、截图、附件、文件名、EXIF、二维码、隐藏层、历史版本和 OCR 输出都必须经过脱敏复核。禁止姓名、学号、手机号、身份证号、邮箱、精确住址、账号和可逆链接。需要示例值时使用 `STUDENT_FAKE_001` 等明显虚构占位符。撤回授权后立即隔离该谱系并重新审计受影响 split。

### 2.3 采样与覆盖

候选池先按授权、脱敏、通知谱系和输入质量过滤，再按通知类别、输入类型和难例标签分层抽样。类别规划目标是十类各约 80 条（academic、administrative、activity、finance、housing、health_safety、library、career、transport、other），实际短缺必须记录，禁止用模型生成或合成通知填补。任何单类别不得超过 25%。

难例覆盖须从自然来源中记录，不得为凑数改写通知。至少追踪：多行动、多阶段、条件通知、例外条款、修订/撤销、多截止时间、模糊时间、否定条件、对象范围冲突、附件缺失、OCR 质量问题和无关画像。一个样本可有多个标签；标签出现率是质量报告，不是允许制造样本的理由。

正式分层顺序固定为：授权与脱敏过滤 → 谱系/近重复聚类 → 分层计数 → 按 `source_group` 分配 train/dev/test → 双人标注与仲裁 → 审计 → manifest 冻结。分配失败时停止并报告缺口，不静默破坏谱系完整性。

## 3. Annotation guideline v1

### 3.1 相关性与用户画像

只依据通知明确的人群条件与给定画像判定 `relevant`、`not_relevant` 或 `uncertain`。不能因“都是学生”或常识扩大对象范围；“不适用”“仅限”“除外”“未满足条件”必须保留。画像字段缺失时标为 `uncertain` 或写入 `missing_information`，不得猜测。

### 3.2 行动和 Action Graph

按最小可执行单元拆分行动。材料准备、平台提交、现场确认等不同副作用必须是不同 action/step；顺序和条件使用依赖边表达。每个 action 需要稳定 `action_id`、`verb`、`object`，并记录明确的 deadline、materials、conditions、exceptions、location、platform 或其 `unknown` 状态。

截止时间逐字保留日期、时刻、时区、`前/后/期间/起至` 和周期边界。“尽快”“近期”“之前”等不能换算为具体时刻；未明确的值使用 `null` 与 `unknown`，不允许标成 explicit。多个阶段的截止时间分别记录，不能合并为一个总截止。

建议、可选、可能影响和必须完成必须区分。撤销或替换通知要记录父版本、子版本、生效时间和变更字段；撤销后的行动不得在 gold 中保持有效。

### 3.3 材料、条件、例外与 unknown

材料逐项标注，只有原文明确要求或明确作为提交附件时才进入 `required_materials`。缺少附件或平台信息写入 `missing_information`，而不是使用常见校园流程补全。条件和例外附着到实际受影响的行动；条件不能被折叠成无条件行动。

`unknown` 表示原文不足以确定；`uncertain` 表示画像匹配或语义范围无法稳定决定；`conflict` 表示同一通知谱系存在无法用版本关系消解的冲突。三者都必须出现在可审计字段中，并影响评测状态或 Critical Error 判定。

## 4. Dual-annotation and adjudication protocol

每条正式样本必须由 Annotator A 和 Annotator B 独立完成。双方在独立工作区读取相同的原文、布局、画像和协议版本，不得看到对方答案、模型输出或前一轮仲裁；系统记录开始/提交时间、工具版本、协议版本和结果哈希。

提交后由工具做字段级 disagreement detection，至少比较相关性、类别、行动集合/顺序、每个 deadline、材料集合、条件/例外、unknown/conflict 标签和 evidence spans。自动比较只发现差异，不生成 gold。

仲裁员只查看原文、布局、画像、协议和双方独立结果，不以模型输出或多数投票替代证据判断。仲裁记录必须逐字段保存：选择的值、理由、引用的 span、不可决定项、裁决人、时间、协议版本以及 A/B 旧值哈希。任何 gold 修改使用追加式 `change_history`，不得覆盖原始独立标注。

一致性门禁在正式扩展前执行：离散字段 Cohen’s kappa ≥ 0.80；0.67–0.80 需复训、抽查并重新仲裁；< 0.67 停止扩展并重标该字段。证据 token/span F1 ≥ 0.90；低于目标先检查 OCR 和边界规则，再按协议重标。阈值是预注册质量门禁，不能因结果不达标而事后改动。

## 5. Gold evidence span protocol

Evidence 是正式标注对象，不得后补。`raw_input.ocr_text` 是该样本的唯一偏移基准，使用 Unicode 字符索引和半开区间 `[text_start,text_end)`；标注提交后不得再做会改变字符位置的归一化。每个 span 必须能在保存的 OCR 文本中逐字复现。

- 最小粒度是支持一个字段的最短连续文本；同一字段需要多处支持时保存多个 span，不跨越无关文字。
- 跨句或跨页证据拆成多个 span，并在 `evidence_group_id` 中关联；page/block/bounding box 作为定位附加信息，不能替代文本 span。
- 条件、例外、否定和撤销使用 `polarity` 标记，并绑定到受影响字段/行动；负面证据不能被当作正面要求。
- 原文不存在支持时不得制造 span，字段标为 `unknown`/缺失；模型或常识推断不构成 gold evidence。
- OCR 偏差逐字保留。若图片中的视觉文字与 OCR 文本不一致，保存 OCR 版本、质量标记和版面定位；不得静默改写偏移基准。

产品投影中的 evidence 引用与 benchmark span 必须通过审计映射；映射失败时该字段不能被视为有证据。

## 6. Split and leakage policy

正式 split 名称固定为 `train`、`dev`、`test`，数量固定为 480/160/160。所有同一 `source_group`、通知修订链、撤销链、同一事件的截图/PDF、相同原始附件和明确复制变体必须进入同一 split。

自动审计必须同时检查：

1. split 内外重复 `sample_id`；
2. `source_group` 跨 split；
3. 去空白、大小写和 Unicode 空白后的 exact OCR 文本重复；
4. OCR 文本近重复（注册阈值 `SequenceMatcher >= 0.92`，并报告候选对供人工复核）；
5. 同一授权来源/学校模板、文件哈希、附件哈希和 revision/revocation 关系；
6. 复制改日期、截图裁剪、仅改变标题/日期的语义重复；
7. train/dev/test 与独立专项集之间的 exact/near duplicate。

近重复阈值命中即阻断冻结，不能以“类别不同”或“日期不同”豁免。工具输出候选对、谱系和审计版本；人工确认后才能把例外写入审计记录。

## 7. Formal evaluator v1

正式 evaluator 版本固定为 `campus-action-bench-evaluator/v1.0.0`，实现入口为 `tools/evaluation/formal-evaluator.ts`。输入记录必须保留首次输出和状态；每条状态只能是 `success`、`failed`、`refused`、`timeout` 或 `parse_failed`。所有状态进入分母，缺失预测按空集合/unknown 处理，不能删行。

主指标和统计口径固定如下：

| 指标 | 口径 |
| --- | --- |
| Action Precision / Recall / F1 | micro，按所有 action 的匹配计数汇总 |
| Deadline Exact Match | sample-level，缺失/失败不匹配 |
| Relevance Accuracy | sample-level，`uncertain` 是独立标签 |
| Material Precision / Recall / F1 | micro；正式记录必须提供空数组而非省略字段 |
| Evidence Coverage | sample-level 关键字段有至少一条合法证据的平均比例 |
| Evidence Span F1 | micro，精确匹配 `[start,end)`，不得用模型改写文本对齐 |
| Critical Error Rate | 有任一冻结 Critical Error 的样本数 / 总样本数 |
| Unsupported Critical Claim Rate | 无证据关键断言数 / 关键断言总数；分母为 0 时报告 0 并显式记录 |

报告同时输出状态计数、split、评测器版本、代码/规则/Prompt/OCR/provider 标识及配置哈希。micro 指标不使用 macro 平均掩盖少数类；正式报告按类别和难例标签附加输出 sample-level macro 摘要。人工修订只用于错误分析，不能替换首次输出。

## 8. Critical Error protocol v1

以下规则冻结为机器可读代码，见 `benchmark/protocol/critical-error-rules-v1.json`。任意一项命中即样本 Critical Error；规则需要 gold、首次预测和 evidence 对齐共同判断：

| code | 判定 |
| --- | --- |
| `FABRICATED_DEADLINE` | 预测具体截止时间，但 gold 为 unknown 或没有对应证据 |
| `DEADLINE_BOUNDARY_EXPANSION` | 把“前/后/期间/起至”等边界或时区扩大、缩小或改写 |
| `AUDIENCE_SCOPE_ERROR` | 把目标人群扩大、缩小到相反人群或忽略明确排除条件 |
| `UNSUPPORTED_MATERIAL` | 预测 gold 未要求且无合法 evidence 的必交材料 |
| `FABRICATED_PLATFORM` | 预测 gold 未出现且无合法 evidence 的提交平台/入口 |
| `MERGED_DEADLINES` | 把两个或以上不同阶段/行动的截止合并为一个 |
| `CONDITION_DROPPED` | gold 有条件/例外，预测变为无条件或丢失例外 |
| `RECOMMENDATION_AS_REQUIREMENT` | 将建议、可选或提醒输出为必须完成 |
| `POSSIBILITY_AS_CERTAINTY` | 将可能影响/不确定输出为确定事实 |
| `CONFLICT_AS_CERTAINTY` | 在来源冲突未消解时输出确定行动或截止 |
| `REVOKED_ACTION_ACTIVE` | 已撤销/替换的行动仍被预测为当前有效 |

产品 Error Shield 的 `MISSING_EVIDENCE`、`UNSUPPORTED_CLAIM`、`DEADLINE_UNSAFE`、`CONFLICTING_STATE`、`DANGLING_REFERENCE` 和 `TASK_SIDE_EFFECT_BLOCKED` 必须映射到正式报告的 Critical Error 计数，但不得用映射掩盖 benchmark 原始错误代码。

## 9. Manifest and experiment freeze procedure

正式 manifest 必须通过 `benchmark/schema/campus-action-bench-manifest-v1.schema.json`，并包含 split 计数、每个文件的 SHA-256/字节数/记录数、协议版本、评测器版本、泄漏审计结果、冻结代码提交和至少两名复核人。manifest 的 `test` 文件必须独立只读保存。

冻结顺序固定为：

1. 完成授权、脱敏和来源撤回检查；
2. 对全量候选运行 schema、质量、重复和泄漏审计；
3. 按 `source_group` 生成一次性 480/160/160 split；
4. 完成双人独立标注、disagreement report 与仲裁；
5. 复跑审计并由两名复核人核对 test 顺序和证据；
6. 锁定代码提交、依赖、模型/provider、Prompt、规则、OCR、时钟和 evaluator 版本；
7. 生成并验证 manifest，设置 test 数据只读/受控访问；
8. 只读方式执行一次正式 test 评测，保存首次输出、失败状态、日志摘要和结果哈希；
9. 任何哈希、配置、test 读取或输出缺失都使该实验无效并停止发布。

`verify` 失败时不能在同一 manifest 上修补后重算；必须产生新的候选版本和新的变更记录。正式 test 在第 7 步以前不得被 parser、规则、Prompt 或错误分析读取。

## 10. Three-person handoff

- Person 1：数据工程、manifest、ingestion、split、授权/脱敏 QC、泄漏审计和仲裁组织；不得依据模型输出决定 gold。
- Person 2：Annotator A，独立完成全量或分配到的样本并保留原始提交。
- Person 3：Annotator B，使用独立工作区完成同一批样本，不查看 Person 2 结果。

出现 disagreement 时，Person 1 只组织仲裁并检查证据完整性；具体裁决按本协议完成，不能用多数票、模型建议或“看起来合理”替代原文证据。三人入场前必须阅读本协议、签署访问/授权边界并通过 5 条 synthetic dry-run；dry-run 不进入正式数据。

## 11. Entry conditions for formal data production

只有以下条件全部满足，Phase 3 才能从 `PROTOCOL_FROZEN` 进入正式数据生产：

- 授权模板、撤回流程、脱敏清单和受控存储已由 Person 1 验证；
- 双人标注工具能隔离工作区、保存结果哈希并生成 disagreement report；
- manifest schema、split/leakage audit、evaluator 和 Critical Error rules 的版本已锁定；
- 三人完成 synthetic dry-run，且不把 dry-run 当作正式一致性结果；
- 候选来源池达到可审计规模，预计能在不使用 synthetic 数据的前提下完成 480/160/160；
- test 访问控制和只读策略已验证；
- 首次正式数据生产的代码提交和配置获得两人复核。

Phase 3 当前裁决：`PHASE3_PROTOCOL_STATUS = FROZEN`。
当前正式数据状态：`FORMAL_DATA_COLLECTION_STATUS = NOT_STARTED`。
