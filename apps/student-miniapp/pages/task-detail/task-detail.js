const api = require('../../utils/api');

Page({
  data: { task: null, action: null, loading: true, completing: false, error: '' },
  onLoad(options) { this.taskId = options.taskId; this.load(); },
  onShow() { if (this.taskId && this.data.task) this.load(); },
  load() { api.getTask(this.taskId).then((result) => { const action = result.action; const steps = action && action.steps ? action.steps.map((step) => step.instruction || step).join(' → ') : result.task.title; const conditions = action && action.conditions ? action.conditions.map((item) => item.statement || item).join('；') : '请根据原通知完成。'; const platform = action && action.platform && action.platform.value ? action.platform.value : '待确认'; this.setData({ task: result.task, action, actionSteps: steps, actionCondition: conditions, actionPlatform: platform, loading: false, error: '' }); }).catch(() => this.setData({ loading: false, error: '任务读取失败，请返回重试。' })); },
  openEvidence() { if (this.data.action) wx.navigateTo({ url: `/pages/evidence/evidence?actionId=${this.data.action.action_id}` }); },
  complete() {
    this.setData({ completing: true, error: '' });
    api.completeTask(this.taskId).then(() => { wx.showToast({ title: '任务已完成', icon: 'success' }); this.load(); }).catch(() => this.setData({ error: '任务完成失败，请重试。' })).finally(() => this.setData({ completing: false }));
  },
});
