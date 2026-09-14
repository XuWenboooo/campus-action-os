const api = require('../../utils/api');

Page({
  data: { tasks: [], error: '' },
  onShow() {
    api
      .getTasks()
      .then((result) => this.setData({ tasks: result.tasks || [], error: '' }))
      .catch(() => this.setData({ error: '任务加载失败，请检查本地 API 是否启动。' }));
  },
  openImport() {
    wx.navigateTo({ url: '/pages/import/import' });
  },
  openTasks() {
    wx.navigateTo({ url: '/pages/tasks/tasks' });
  },
  openProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' });
  },
  openSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' });
  },
});
