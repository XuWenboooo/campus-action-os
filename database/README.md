# SQLite 数据层

开发和测试使用 Node 26 的 `node:sqlite`，不依赖外部生产服务。`database/migrations/` 是唯一迁移来源，运行时数据库位于 `DATABASE_PATH` 指定路径，默认是被 `.gitignore` 排除的 `data/campus-action-os.sqlite`。

```text
npm run db:migrate
```

测试使用 `:memory:` 数据库；正式数据、实验结果和合成夹具不共享同一个数据库文件。
