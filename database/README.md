# SQLite 数据层

开发和测试使用 Node 26 的 `node:sqlite`，不依赖外部生产服务。`database/migrations/` 是唯一迁移来源，运行时数据库位于 `DATABASE_PATH` 指定路径，默认是被 `.gitignore` 排除的 `data/campus-action-os.sqlite`。

```text
npm run db:migrate
```

测试使用 `:memory:` 数据库；正式数据、实验结果和合成夹具不共享同一个数据库文件。`document_files` 只保存受限的 PNG/JPEG/PDF 二进制源，并通过外键随文档删除；读取时校验字节数和 SHA-256。行动变更历史单独写入 `action_change_history`，只允许追加。
