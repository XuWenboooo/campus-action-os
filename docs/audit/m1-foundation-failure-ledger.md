# M1 Foundation Failure Ledger（append-only）

所有已观察的执行失败保留在此；修复后追加 RESOLVED，不删除首次失败。

| Run ID                  | 命令/阶段                                               | 首次失败                                      | 根因                                           | 科研结论影响 | 修复与复验                                                                                  | 状态     |
| ----------------------- | ------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------- | -------- |
| `M1-20260914-123000-00` | 冻结原件路径检查                                        | 指定的旧路径不存在                            | 实际 WeChat 路径包含 `_9e56` 目录              | 无           | 只读搜索定位权威原件，随后字节复制并核验哈希                                                | RESOLVED |
| `M1-20260914-125100-05` | `npm run typecheck`                                     | Ajv 2020 默认导入类型不可构造                 | NodeNext 下包导出类型形状不同                  | 无           | 改用 named `Ajv2020` 和显式格式插件类型，typecheck/build 复验通过                           | RESOLVED |
| `M1-20260914-125200-06` | `python -m pytest -q tests/contracts tests/integration` | 14 个旧协议样例失败                           | Schema 已按冻结字段修正，样例仍使用旧字段/枚举 | 无           | 迁移 12 个开发正例、更新 Graph 反例，58 tests 后续通过                                      | RESOLVED |
| `M1-20260914-125300-07` | `npm run test:built`                                    | 构建产物首次出现 MODULE_TYPELESS warning      | 根 package 未声明 module 类型                  | 无           | package 增加 `type: module`，构建产物加载测试复验通过                                       | RESOLVED |
| `M1-20260914-125400-08` | staged 敏感扫描                                         | 中文冻结路径被 Git C-quote，扫描器 ENOENT     | `git ls-files` 非 NUL 原始路径输出             | 无           | 改用 `git ls-files -z`，54 tracked files 扫描通过                                           | RESOLVED |
| `M1-20260914-125600-09` | 一次完整验证命令                                        | 执行被外部回合中断                            | 工具/回合生命周期中断，非代码失败              | 无           | 重新读取 Runbook 和当前状态后从中断点继续，后续完整验证通过                                 | RESOLVED |
| `M1-20260914-125700-11` | `npx prettier` 试图处理 Python 文件                     | Prettier 没有 Python parser，输出 parser 错误 | 格式化命令误覆盖到 Python 文件                 | 无           | Python 文件由 pytest/compileall 校验；改为只格式化 JS/TS/Markdown，`npm run check` 复验通过 | RESOLVED |

补充说明：早期日志中的“58 tests”是迁移过程中的中间计数；最终本地复验为 contracts 53、integration 6、Benchmark unittest 4，均通过。

| `M1-20260914-130100-12` | 推送 `integration/m1-foundation` 至 GitHub | 3 次 HTTPS 推送均在连接 `github.com:443` 时失败；`curl` 连接测试同样超时 | 当前执行环境无可用 GitHub 网络通道 | 无 | 未改写本地或远端历史；检查代理/配置后保留本地提交，待网络恢复后按原分支重试 | BLOCKED |
| `M1-20260914-130600-13` | 恢复后的远程通道复验 | `curl` 8 秒超时，随后 HTTPS push 再次在 `github.com:443` 失败 | 外部网络通道仍不可达 | 无 | 远端状态未变；保留干净本地分支并追加证据，等待后续外部状态变化 | BLOCKED |
| `M1-20260914-131400-15` | 发布记录提交推送 | `480efa6` 的 3 次 HTTPS push 均连接超时或被重置 | GitHub Git smart-HTTP 通道间歇性不可达 | 无 | GitHub API 仍可读，远端 branch ref 权威确认仍为 `a0e5002`；未改写历史，继续有限重试 | BLOCKED |
