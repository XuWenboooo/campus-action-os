const api = require('../../utils/api');

Page({
  data: { tasks: [], error: '' },
  onShow() {
    api
      .getTasks()
      .then((result) => this.setData({ tasks: result.tasks || [], error: '' }))
      .catch(() => this.setData({ error: '任务加载失败。' }));
  },
});
