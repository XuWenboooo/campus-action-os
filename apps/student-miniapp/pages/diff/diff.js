const api = require('../../utils/api');

Page({
  data: { diff: null, loading: true, applying: false, applied: false, error: '' },
  onLoad() { this.load(); },
  load() { api.getNotificationDiff().then((diff) => this.setData({ diff, loading: false })).catch(() => this.setData({ loading: false, error: '变化读取失败，请重试。' })); },
  apply() { this.setData({ applying: true, error: '' }); api.applyNotificationDiff().then(() => { this.setData({ applied: true }); wx.showToast({ title: '任务已同步更新', icon: 'success' }); }).catch(() => this.setData({ error: '同步失败，请重试。' })).finally(() => this.setData({ applying: false })); },
  openEvidence() { wx.navigateTo({ url: '/pages/evidence/evidence?actionId=action-extension' }); },
});
