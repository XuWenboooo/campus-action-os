const api = require('../../utils/api');

Page({
  data: { diff: null, loading: true, applying: false, applied: false, error: '' },
  onLoad(options) { this.changeEventId = options && options.changeEventId; this.load(); },
  load() { api.getNotificationDiff(this.changeEventId).then((diff) => this.setData({ diff: { ...diff, impacts: diff.impacts || [] }, loading: false })).catch(() => this.setData({ loading: false, error: '变化读取失败，请重试。' })); },
  apply() { this.setData({ applying: true, error: '' }); api.applyNotificationDiff(this.changeEventId).then((result) => { this.setData({ applied: true }); wx.showToast({ title: '任务已同步更新', icon: 'success' }); setTimeout(() => wx.navigateTo({ url: `/pages/task-detail/task-detail?taskId=${result.task_id || 'task-extension'}` }), 550); }).catch(() => this.setData({ error: '同步失败，请重试。' })).finally(() => this.setData({ applying: false })); },
  openEvidence() { wx.navigateTo({ url: '/pages/evidence/evidence?actionId=action-extension' }); },
});
