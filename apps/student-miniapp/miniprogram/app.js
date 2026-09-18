// Campus Action OS · 学生端小程序宿主入口
// 说明：本文件补齐的是「可运行宿主」，不代表业务页面或 AI 解析能力已实现。
// 客户端只允许调用 API 服务，模型密钥不得进入小程序包。

App({
  globalData: {
    // 本地开发用 API 边界地址（对应 services/api，默认监听 3000）
    apiBaseUrl: 'http://localhost:3000',
    protocolVersion: 'v1',
    hostStage: 'M1 工程基础 / M2 文本接口检查点',
  },

  onLaunch() {
    console.log('[Campus Action OS] 学生端宿主启动', this.globalData.hostStage);
  },

  onError(err) {
    console.error('[Campus Action OS] 宿主异常', err);
  },
});
