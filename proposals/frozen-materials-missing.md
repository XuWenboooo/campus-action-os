# Proposal: 将冻结实验方案纳入仓库

历史记录：在核心协议提交时，`main` 的 Git 树仅包含初始化 README；`CODEX_HANDOFF_SUMMARY.md` 引用了 `信息翻译器_一等奖版_冻结实验与程序目标_v1.0.md`，但该文件尚未纳入仓库，因此协议工作是在未读取仓库内原文时完成的。

现状：权威原文已按原始字节复制到 `docs/frozen/信息翻译器_一等奖版_冻结实验与程序目标_v1.0.md`，索引和 SHA-256 见 `docs/frozen/README.md`。本提案保留历史记录，不删除或覆盖原协议提交。

审计结论：原文第 4 节是产品级高层数据结构，而 `schemas/v1/` 是当前机器可读协议权威来源；两者存在字段命名、枚举和状态分层差异，详见 `docs/protocol-benchmark-compatibility.md` 与 `proposals/frozen-protocol-audit-v1.md`。差异不在本次直接改写冻结文件；需要改变冻结定义时必须创建新版本。
