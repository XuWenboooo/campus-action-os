# CampusActionBench v1 正式评测运行手册

正式 evaluator 版本固定为 `campus-action-bench-evaluator/v1.0.0`，完整冻结协议见 `docs/benchmark/phase3-protocol-v1.md`。当前没有正式评测结果。

正式评测仅在授权数据、双人标注/仲裁、审计通过和测试 manifest 双人复核后执行。评测负责人先锁定代码提交、模型标识、Prompt、规则、解析配置、依赖和时钟；对冻结测试集执行一次读取，保存原始模型输出、状态、日志摘要和配置哈希。B1/B2/S0 对照实验在所有前置条件具备前不得运行；本仓库当前没有正式评测结果。

每条输入均产生 `success`、`failed`、`refused`、`timeout` 或 `parse_failed` 状态之一；全部状态进入分母。首次输出单独保存，人工纠错只能作为错误分析，不能替换首次输出。报告应包含 Action P/R/F1、Deadline Exact Match、Relevance Accuracy、Material F1、Evidence Coverage、Unsupported Critical Claim Rate、Critical Error Rate、覆盖分层和缺失值说明。

评测后以只读方式复核 manifest；任何哈希不一致、测试集读写、Prompt 修改或输出缺失都使运行无效并停止发布。专项时间测试集另行冻结，不与开发/验证/测试集合并。
