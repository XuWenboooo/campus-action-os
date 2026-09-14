# Campus Action OS M1 Foundation v1.0.0

状态：FINAL（远程 CI 已通过，`main` 已快进封板，`m1-foundation-v1.0.0` 已创建）

## 范围

本发布只包含工程地基、共享协议运行时入口、Benchmark 开发样例隔离、质量门禁和本地开发文档。它不声明 AI 解析、正式数据集、准确率、用户量或实验结果已经实现。

## 可复现锚点

- 冻结方案：`docs/frozen/信息翻译器_一等奖版_冻结实验与程序目标_v1.0.md`
- 冻结方案 SHA-256：`F17072D340314E5C4A01B13B1D017F8ABF35ECCDF9C60D3995380FCD776E712D`
- 产品协议：`verified-action-object/v1`、`action-graph/v1`
- TypeScript 共享包：`@campus-action-os/protocol@1.0.0`
- Benchmark：`CampusActionBench v1`
- 发布清单：`docs/releases/m1-foundation-v1.0.0.manifest.sha256`
- CI：tag 目标提交对应 run `34809082935`，[workflow run 链接](https://github.com/XuWenboooo/campus-action-os/actions/runs/34809082935)

## 验证范围

本地门禁包含格式、lint、TypeScript 类型检查、Node 单元测试、构建后协议加载测试、Python 契约/Benchmark/集成测试、开发样例审计、敏感信息扫描和发布清单校验。远程 CI 必须执行同一套 `npm run check`。

## 尚未实现

真实通知采集、认证、数据库迁移、AI provider、Prompt/规则编排、微信小程序业务页面、管理端业务、生产部署、正式 800 条数据、正式测试集冻结、正式实验和真实试点均未实现。

## 回滚锚点

如 M1 发布需要回滚，回到本标签的直接父提交（`git rev-parse m1-foundation-v1.0.0^`）并保留审计日志；禁止改写已发布标签或使用强制推送。
