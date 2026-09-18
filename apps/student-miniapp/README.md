# Student mini-program boundary

微信小程序宿主目录。页面、AppSecret 和模型密钥尚未接入；客户端只允许调用 API 服务。

`src/protocol.ts` 是客户端与共享协议包的唯一边界；它不在小程序包内保存模型服务密钥。

---

## 运行宿主（本目录补充，非上游实现）

上游仓库在此目录只保留了边界占位文件（`README.md`、`package.json`、`src/protocol.ts`），
**不含 `app.json`、页面**，因此直接导入微信开发者工具会报
`app.json: 在项目根目录未找到 app.json`。下面这些文件是为「能在微信开发者工具中编译运行」
补齐的最小宿主骨架：

```
project.config.json          # 开发者工具项目配置；已补 miniprogramRoot，appid 沿用你已有的
miniprogram/
├── app.js                   # 宿主入口，globalData 持有 API 边界地址
├── app.json                 # 页面注册与窗口配置
├── app.wxss                 # 全局样式
├── sitemap.json
├── utils/
│   ├── api.js               # 调用 API 边界（/health、/v1/capabilities）
│   └── demo-graph.js        # 符合 action-graph/v1 的确定性演示数据
└── pages/index/             # 宿主自检页（index.js / .json / .wxml / .wxss）
```

边界约束未变：本目录不保存 AppSecret 或模型密钥，页面只通过 `utils/api.js` 访问 API 服务。

### 打开方式

1. 微信开发者工具 → 导入项目 → 目录选择本目录（`apps/student-miniapp`）。
2. AppID：`project.config.json` 里已有 AppID 就直接用；为空或为 `touristappid` 则保持游客模式。
3. 新增文件保存后工具会自动重编译；没反应就按 `Ctrl+B`。

### 能力边界（务必区分）

页面上的「通知 → 行动」区块**不是 AI 解析结果**，它渲染的是 `utils/demo-graph.js` 中的
固定演示数据，用于验证宿主渲染链路。真实解析、数据库、业务页面仍处于未实现状态，
与上游 README 的「尚未实现」清单一致。

### 协议层 / 视图层分离

`schemas/v1/action-graph.schema.json` 声明了 `unevaluatedProperties: false`，
所以任何为显示而加的字段挂在节点上都会让对象**不合规**。`demo-graph.js` 因此分两层返回：

- `protocol` —— 严格符合 `action-graph/v1` 的协议对象，不含任何展示字段，可直接用于协议用途
- `nodesView` / `edgesView` —— 视图模型，在协议之上补充中文摘要与原文证据；页面只读这两个

### 注意

- 新增文件是给小程序编译器用的（`var` / `wx` 全局变量 / CommonJS）。若在上游仓库执行
  `npm run check`，prettier / eslint 可能会扫到它们，必要时把
  `apps/student-miniapp/miniprogram/` 加进 `.prettierignore` 和 eslint ignore。
- `project.private.config.json` 里 `urlCheck: true` 时，页面上的「探测 API 边界」按钮访问
  `http://localhost:3000` 会被拦截。要用需先 `npm run dev:api`，并在
  「详情 → 本地设置」勾选「不校验合法域名」。
