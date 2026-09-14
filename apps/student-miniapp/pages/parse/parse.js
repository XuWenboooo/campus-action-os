const api = require('../../utils/api');

Page({
  data: {
    job: null,
    assessment: null,
    actions: [],
    error: '',
    canManual: false,
    manualTitle: '',
    manualDueAt: '',
  },
  onLoad(options) {
    this.jobId = options.jobId;
    this.loadJob();
  },
  onUnload() {
    if (this.timer) clearTimeout(this.timer);
  },
  loadJob() {
    api
      .getParseJob(this.jobId)
      .then((job) => {
        const result = job.result || {};
        this.setData({
          job,
          assessment: result.document_assessment || null,
          actions: result.verified_actions || [],
          canManual: job.status === 'failed',
          error: '',
        });
        if (['queued', 'running'].includes(job.status))
          this.timer = setTimeout(() => this.loadJob(), 1000);
      })
      .catch(() => this.setData({ error: '解析任务读取失败，请稍后重试。' }));
  },
  confirm(event) {
    const actionId = event.currentTarget.dataset.id;
    api
      .confirmAction(actionId)
      .then(() => api.createTask(actionId))
      .then(() => {
        wx.showToast({ title: '任务已创建', icon: 'success' });
        wx.navigateTo({ url: '/pages/index/index' });
      })
      .catch(() => this.setData({ error: '确认或创建任务失败，未执行外部副作用。' }));
  },
  reject(event) {
    api
      .rejectAction(event.currentTarget.dataset.id)
      .then(() => this.loadJob())
      .catch(() => this.setData({ error: '拒绝操作失败。' }));
  },
  onManualTitle(event) {
    this.setData({ manualTitle: event.detail.value });
  },
  onManualDueAt(event) {
    this.setData({ manualDueAt: event.detail.value });
  },
  manualCreate() {
    const title = (this.data.manualTitle || '').trim();
    const documentId = this.data.job && this.data.job.document_id;
    if (!documentId || !title) {
      this.setData({ error: '请填写人工任务标题。' });
      return;
    }
    this.setData({ error: '' });
    api
      .createManualTask(documentId, title, (this.data.manualDueAt || '').trim())
      .then(() => {
        wx.showToast({ title: '人工任务已创建', icon: 'success' });
        wx.navigateTo({ url: '/pages/tasks/tasks' });
      })
      .catch(() => this.setData({ error: '人工任务创建失败，请确认后重试。' }));
  },
});
