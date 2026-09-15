const api = require('../../utils/api');

Page({
  data: { task: null, action: null, loading: true, completing: false, error: '' },
  onLoad(options) { this.taskId = options.taskId; this.load(); },
  onShow() { if (this.taskId && this.data.task) this.load(); },
  load() { api.getTask(this.taskId).then((result) => this.setData({ task: result.task, action: result.action, actionSteps: result.action ? result.action.steps.join(' → ') : result.task.title, loading: false, error: '' })).catch(() => this.setData({ loading: false, error: '任务读取失败，请返回重试。' })); },
  openEvidence() { if (this.data.action) wx.navigateTo({ url: `/pages/evidence/evidence?actionId=${this.data.action.action_id}` }); },
  complete() {
    this.setData({ completing: true, error: '' });
    api.completeTask(this.taskId).then(() => { wx.showToast({ title: '任务已完成', icon: 'success' }); this.load(); }).catch(() => this.setData({ error: '任务完成失败，请重试。' })).finally(() => this.setData({ completing: false }));
  },
});
