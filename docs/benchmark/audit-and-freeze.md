# 审计、划分与冻结操作手册

Phase 3 冻结入口：`docs/benchmark/phase3-protocol-v1.md`。泄漏审计工具版本为 `cab/2.0.0`；正式 manifest 必须通过 `benchmark/schema/campus-action-bench-manifest-v1.schema.json`。

`python tools/benchmark/cab.py audit benchmark/dev_samples.jsonl --development` 只做开发样例审计；仓库脚本 `npm run benchmark:audit` 已显式传入 `--development`。审计工具会逐条校验 `benchmark/schema/campus-action-bench-v1.schema.json`，并检查重复 ID、缺字段、失效证据、敏感信息、合成未标记及跨谱系/近重复风险。正式审计要求输入总量 800 且目标为 480/160/160；单类别不得超过 25%，并报告多行动、人群条件、无关画像、多阶段、附件、歧义、OCR、低质量输入、变更场景覆盖率。`--expected` 还要求真实/合规重构来源、已记录授权、双人独立标注、仲裁完成和稳定 `source_group`。正式数据不应使用 `--development` 绕过门槛。

正式切分使用 `python tools/benchmark/cab.py split <candidate.jsonl> --out-dir <controlled-dir> --seed 20260915 --stratify notice_category --formal`；若无法在保持 `source_group` 完整的前提下得到精确 480/160/160，工具必须失败。切分后使用 `python tools/benchmark/cab.py leakage --train <train.jsonl> --dev <dev.jsonl> --test <test.jsonl>` 检查 ID、谱系、哈希、exact 文本、near duplicate 和修订关系；使用 `validate-manifest` 校验正式 manifest schema。

划分：`python tools/benchmark/cab.py split input.jsonl --out-dir splits --seed 20260914 --stratify notice_category`。按 `source_group` 聚合，确定性排序后分层分配；同源通知、变体、修订链只能进入一个集合。已有 `test.manifest.json` 时拒绝覆盖，必须换输出目录并人工审查。

正式冻结前：完成授权与脱敏复核 → 审计通过 → 生成一次性划分清单 → 独立保存测试集 → 锁定 Prompt/模型/规则/代码版本 → `freeze` 生成文件、顺序、配置和版本的 SHA-256 清单 → 将 manifest 设为只读/受控存储 → 双人验证 → 正式评测。`verify` 失败即停止，不修补后重算同一结果。

运行手册要求每次保存首次原始输出、失败/拒答/超时/解析失败和追加式结果；这些状态都进入分母。禁止人工纠错结果代替首次输出，禁止在冻结测试集上调整 Prompt。B1/B2/S0 正式对照实验当前未运行。
