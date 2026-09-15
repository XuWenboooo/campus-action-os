# TEAM_ROLE_AMENDMENT — CampusActionBench-800

修订版本：`campus-action-bench-team-roles/v1.0.0`

适用基线：Phase 3 Protocol `campus-action-bench-protocol/v1.0.0`

协议状态：`PHASE3_PROTOCOL_STATUS = FROZEN`
本修订只改变人员职责、访问权限和 test isolation，不改变 Dataset Specification、split、Annotation、Evidence、Evaluator、Critical Error 或 Leakage 语义。

## 角色

| 人员                                                      | 固定职责                                                                                                                                                                                                                                                                                                                                           | 禁止职责                                                                        |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Person A — Project / Data / Evaluation Lead + Annotator A | Phase 3 工程协调、dataset pipeline、candidate ingestion、授权/脱敏、manifest、versioning、reproducibility、Git/artifact freeze、duplicate/leakage audit、split/sealing、Annotator A、disagreement/adjudication workflow、evaluator/experiment manifest freeze、model artifact hash 接收、test authorization、最终 test execution 和 metrics export | 在 Person B 独立提交前查看 B 的答案；依据模型输出决定 gold；单方面覆盖 B 的标注 |
| Person B — Independent Annotator B                        | 第二份独立 gold/evidence span 标注、提交后的 disagreement review、annotation QA                                                                                                                                                                                                                                                                    | 在独立提交前查看 A 的答案；用模型预测决定 gold                                  |
| Person C — Model Training Lead                            | 模型训练、parser/model architecture、prompt/rule development、training pipeline、Train/Dev evaluation、hyperparameter tuning、ablation、experiment logging、reproducibility                                                                                                                                                                        | 正式双人 gold annotation；test gold adjudication；在正式 test 前访问 test 内容  |

Person A 与 Person B 的第一次标注必须在隔离工作区独立完成。提交后才允许依据冻结 guideline 和 source evidence 进行 disagreement review。若仍无法解决，记录 `ADJUDICATION_STATUS = PENDING_EXTERNAL_REVIEW`，不得用模型预测补齐 gold。

## A ↔ C delivery boundary

Person A → Person C 只交付 Train/Dev documents、Train/Dev gold 与 evidence、training manifest、冻结 schema 和 evaluator contract；不交付 Test raw/OCR/gold/evidence、per-case errors 或 disagreement/adjudication records。Person C → Person A 在正式 test 前必须交付并冻结：model artifact、model SHA-256、code commit、dependency lock、config、prompt/rules、hyperparameters、random seeds、training log、Dev results 和 inference command。

## 访问矩阵

| 数据或产物                                               | Person A                         | Person B                         | Person C                                                                |
| -------------------------------------------------------- | -------------------------------- | -------------------------------- | ----------------------------------------------------------------------- |
| Train 480：document/OCR/gold/evidence                    | read/write（按数据流程）         | assigned annotation workspace    | read/write，用于训练和 Train evaluation                                 |
| Dev 160：document/OCR/gold/evidence/errors               | read/write（按 QA 流程）         | assigned annotation workspace    | read，用于 model selection、prompt/rule/hyperparameter tuning、ablation |
| Test 160 raw documents/OCR/gold/evidence                 | sealed；仅授权的最终执行窗口可读 | sealed；仅授权的最终执行窗口可读 | **DENIED**，直到正式 evaluation authorization 完成                      |
| Test disagreement/adjudication records/per-sample errors | sealed；最终执行管理所需时读取   | sealed；完成仲裁后按授权读取     | **DENIED**                                                              |
| Test aggregate metadata                                  | 可读                             | 可读                             | 仅可读 sample count=160、manifest hash、evaluator version 和协议元数据  |

Person C 的 test 访问在以下条件全部满足前保持拒绝：数据/gold 冻结、evaluator 冻结、模型版本冻结、prompt/rules 冻结、hyperparameters 冻结、experiment manifest 冻结、model artifact hash 生成、正式 evaluation authorization 创建。`test_sealed` 不属于普通模型训练工作流。

## 存储与自动门禁

正式数据目录约定为：

```text
data/
  train/
  dev/
  test_sealed/
```

`train/`、`dev/` 和实验日志可供 Person C 使用；`test_sealed/` 使用独立受控存储，不挂载到训练工作流。正式 test ID 清单只由 Person A 在授权评测窗口提供给隔离检查器，不复制到 Train/Dev 目录。

在交付 Train/Dev 或创建实验 manifest 前运行：

```powershell
python tools/benchmark/check-test-isolation.py `
  --test-ids <sealed-test-ids.txt> `
  --scan data/train data/dev experiments
```

检查器只在指定路径内查找 test ID 的字节/文本出现，不输出源文件内容；命中任一 ID、扫描路径缺失或 ID 清单为空即返回失败。允许出现的 test 信息只有不含 sample ID 的 aggregate metadata，例如 `sample_count=160`、manifest hash 和 evaluator version。检查器实现与测试位于 `tools/benchmark/check-test-isolation.py` 和 `tests/benchmark/test_phase3_isolation.py`。

## 5-case synthetic dry-run

正式数据尚未开始。三人先完成 5 条 `data_origin=synthetic` dry-run：

- Person A 以 Annotator A 身份独立标注；
- Person B 以 Annotator B 身份独立标注；
- Person C 只验证最终 gold 的训练/数据接口可消费，不参与 gold 决策；
- 提交前双方互不可见，提交后生成 disagreement、证据和仲裁记录；
- dry-run 结果只验证流程，不进入 CampusActionBench-800，不产生正式指标。

dry-run 通过后，顺序固定为：授权数据准备 → 脱敏 → candidate pool → A/B 独立标注 → disagreement/adjudication → split → leakage audit → manifest freeze → Train/Dev 交付 C → Test 继续 sealed。

本轮已用仓库内 5 条 synthetic cases 实际执行上述流程，生成锁定提交、disagreement、adjudication、final gold、dry-run manifest、Train/Dev delivery package 和 isolation result；产物位于被忽略的 `benchmark/generated/phase3a-dry-run/`，不进入正式 benchmark。

## Amendment entry conditions

本 amendment 不解冻 Phase 3 Protocol。正式数据生产仍须满足冻结协议中的全部 entry conditions；除此之外，必须有：

1. A/B 独立工作区和提交前不可见性验证；
2. C 的 Train/Dev 访问已授权、Test 访问默认拒绝；
3. `check-test-isolation.py` 在交付和每次实验 manifest 变更时通过；
4. 5-case synthetic dry-run 完成并确认 C 未参与 gold 决策；
5. 发生未解决 disagreement 时已记录 `PENDING_EXTERNAL_REVIEW`，没有使用模型预测替代 gold。

本修订后的正式数据状态仍为：`FORMAL_DATA_COLLECTION_STATUS = NOT_STARTED`。
