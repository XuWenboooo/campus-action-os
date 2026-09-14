# Experiment runbook

本仓库当前只允许运行本地 deterministic rule-engine 和 `development_only` 合成夹具。`npm.cmd run evaluate:fixtures` 会保存首次输出、逐样本错误码、聚合指标和 SHA-256 manifest；结果目录位于被忽略的 `benchmark/results/`，不属于正式实验结果。

正式 CampusActionBench 运行前必须完成授权、脱敏、双人标注与仲裁、数据集分层、代码/依赖/模型/Prompt/OCR/规则版本冻结和 manifest 双人复核。正式运行必须将 `success`、`failed`、`refused`、`timeout`、`parse_failed` 全部计入分母，并将模型首次输出与人工修订分开保存。

当前禁止调用真实 provider、读取生产服务或将合成夹具扩充为 800 条正式数据。缺少正式数据、真实 OCR 或 provider 凭据时，运行记录必须保持 `NOT_RUN`，不能以开发评估数字替代冻结结论。
