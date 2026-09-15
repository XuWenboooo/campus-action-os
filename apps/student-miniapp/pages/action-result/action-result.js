const api = require('../../utils/api');

Page({
  data: { action: null, assessment: null, sourceText: '', loading: true, creating: false, error: '' },
  onLoad(options) {
    this.jobId = options.jobId;
    api.getParseJob(this.jobId).then((job) => {
      const result = job.result || {};
      const action = (result.verified_actions || [])[0];
      this.setData({ action, assessment: result.document_assessment, sourceText: result.source_text || '', loading: false });
    }).catch(() => this.setData({ loading: false, error: '行动结果读取失败，请重试。' }));
  },
  openEvidence() { if (this.data.action) wx.navigateTo({ url: `/pages/evidence/evidence?actionId=${this.data.action.action_id}` }); },
  createTask() {
    if (!this.data.action) return;
    this.setData({ creating: true, error: '' });
    api.confirmAction(this.data.action.action_id).then(() => api.createTask(this.data.action.action_id)).then((result) => {
      wx.showToast({ title: '任务已创建', icon: 'success' });
      setTimeout(() => wx.navigateTo({ url: `/pages/task-detail/task-detail?taskId=${result.task.task_id}` }), 500);
    }).catch(() => this.setData({ error: '任务创建失败，请重试。' })).finally(() => this.setData({ creating: false }));
  },
  reject() { api.rejectAction(this.data.action.action_id).then(() => { wx.showToast({ title: '已移除', icon: 'success' }); wx.navigateBack(); }); },
});
