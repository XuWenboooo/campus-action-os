# CampusActionBench v1 数据规范

状态：规范与工具基线（不是数据集，也不包含正式评测结果）。当前目标规模为 800 条：开发/训练 480、验证 160、冻结测试 160。若未来授权数据不足，必须记录为未就绪，不得用合成数据补齐。

## 生命周期与隔离

开发集可用于协议调试；验证集可用于锁定规则和 Prompt；冻结测试集只在正式评测时一次性读取；专项时间测试集独立于三者，用于时间/变更鲁棒性。测试文件、样本顺序、配置、Prompt、规则和代码版本全部进入冻结清单。训练/验证配置不得读取测试目录或测试 manifest。

## 单条样本

机器可读定义见 `benchmark/schema/campus-action-bench-v1.schema.json`，交换格式为 UTF-8 JSONL。必填字段：`sample_id`；`provenance.source_type`、`authorization_status`、`data_origin`；`notice_category`；`raw_input.input_type`、`ocr_text`、`layout`；`user_profile`；`gold.relevance`、`action_graph`、`field_evidence`、`ambiguities`、`conflicts`、`missing_information`、`risk_labels`；`annotation`；`data_version`；`change_history`。

`source_group` 是通知原件、转发、截图裁剪、修订和同一通知变体的稳定谱系键。所有个人信息必须使用明显虚构值或不可逆脱敏占位符（如 `STUDENT_FAKE_001`），禁止姓名、学号、手机号、身份证号、具体住址。

Action Graph 的 action 至少含稳定 `action_id`、动作 `verb`、对象 `object`，并可含 deadline、地点、平台、材料、条件、例外；未知值使用 `null` 加 `unknown`/缺失记录，禁止猜测。协议对象如需随标准答案保存，放入 `gold.protocol_projection`，并由产品 Schema 另行验证；Benchmark 不复制协议字段。证据使用 OCR 文本半开区间 `[text_start,text_end)`，版面证据可附 page/block/bounding box。
