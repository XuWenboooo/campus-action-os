# Phase 3B — Formal Data Collection Runbook

基线：`29f48b492941acc4ef1f0003fdbef7c094a537bc`
Phase 3 Protocol：`FROZEN`
当前正式数据状态：`NOT_STARTED`（仓库当前有效正式候选数为 0）

本 runbook 只执行经授权、已脱敏的真实或合规重构数据。`synthetic`、Phase 3A dry-run 和 30 条 development fixtures 永远不能进入正式 candidate pool，也不能计入 480/160/160。

## Intake gate

候选 registry 使用 UTF-8 JSONL，每行必须有：`candidate_id`、`source_type`、`source_provenance`、`authorization_record_id`、`collection_timestamp`、`data_origin`、`privacy_status`、`document_sha256`、`near_duplicate_fingerprint`、`category_tags`、`revision_family_id` 和 `deidentification_status`。授权 registry 必须提供 source、授权状态、allowed usage、privacy restrictions、collection date 和 provenance。

只有 `authorization_status=AUTHORIZED`、`data_origin ∈ {real,reconstructed}`、`privacy_status=DEIDENTIFIED`、`deidentification_status=APPROVED`、完整稳定 ID/哈希/谱系信息的候选能进入 READY。`PENDING`、`REJECTED`、`RESTRICTED`、synthetic 或未脱敏数据一律阻断并保留原因：

```powershell
python tools/benchmark/phase3b_pipeline.py audit-candidates `
  --input <candidate-registry.jsonl> `
  --authorization <authorization-registry.jsonl> `
  --out <candidate-audit.json>
```

## Annotation batches

READY 候选按 25–50 条一批执行：A 独立标注 → B 独立标注 → lock → disagreement detection → adjudication → QA → schema/evidence validation → batch manifest。批次失败不能进入下一批；未解决争议记录 `PENDING_EXTERNAL_REVIEW`，不能强行生成 gold。

正式状态顺序固定为：

```text
candidate → authorized → deidentified → annotation_A → annotation_B
→ adjudication → gold → split_assigned → frozen
```

不能跳过状态或覆盖原始 A/B submission。Person C 只接收 Train/Dev，Test 继续 sealed。

## Split and freeze gate

只有 final gold 才能执行：

```powershell
python tools/benchmark/cab.py split <gold.jsonl> --out-dir <split-dir> --seed <fixed-seed> --formal
python tools/benchmark/cab.py leakage --train <train.jsonl> --dev <dev.jsonl> --test <test.jsonl>
python tools/benchmark/cab.py validate-manifest <manifest.json>
```

目标必须精确为 Train 480、Dev 160、Test 160；`source_group`、revision/revocation family、exact/near duplicate 和同一事件变体不得跨 split。Test assigned 后立即 sealed，只有数据/gold/evaluator/model/config/manifest/artifact hash/authorization 全部冻结后才能正式评测。

## Roles and delivery

Person A 按 `TEAM_ROLE_AMENDMENT` 负责授权、脱敏、candidate registry、A、仲裁管理、split、leakage、manifest 和 evaluation gatekeeping；Person B 只做独立 B 标注、evidence 和 QA；Person C 只做 Train/Dev ingestion、训练准备和可复现性，不访问 Test 或参与 gold 决策。

A → C 只交付 Train/Dev documents、gold、evidence、manifest、schema 和 evaluator；C → A 在 test authorization 前交付 artifact hash、code commit、依赖锁、config、prompt/rules、hyperparameters、seeds、日志、Dev 结果和 inference command。

当前执行结论：正式候选不足 800，不能创建正式 split/manifest，不能把 Phase 3B 标记为 COMPLETE。下一步是获得并审核授权候选，而不是生成或复制样本。
