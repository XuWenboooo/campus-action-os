const api = require('../../utils/api');

Page({
  data: {
    text: '',
    scenario: 'student',
    scenarioLabel: '',
    loading: false,
    error: '',
    filePath: '',
    fileName: '',
    fileType: '',
    documentId: '',
    canManual: false,
    manualTitle: '',
    manualDueAt: '',
    demoMode: api.isDemoMode(),
  },
  onLoad(options) {
    if (options && options.scenario) {
      this.prepareDemo(options.scenario);
    }
  },
  onInput(event) {
    this.setData({ text: event.detail.value });
  },
  loadScenario(event) {
    const scenario = event.currentTarget.dataset.scenario;
    this.prepareDemo(scenario);
  },
  prepareDemo(scenario) {
    if (!this.data.demoMode) {
      this.setData({ error: '示例通知仅在开发 Demo 模式提供。' });
      return;
    }
    this.setData({ scenario, error: '' });
    api
      .enterDemoScenario(scenario)
      .then(() => api.getDemoScenario(scenario))
      .then((result) => this.setData({ scenarioLabel: result.label, text: result.source }))
      .catch(() => this.setData({ error: '示例通知读取失败，请检查 Demo 模式。' }));
  },
  chooseFile() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['png', 'jpg', 'jpeg', 'pdf', 'wav'],
      success: (result) => {
        const file = result.tempFiles && result.tempFiles[0];
        const name = (file && file.name) || '';
        const extension = name.toLowerCase().split('.').pop();
        const fileType =
          extension === 'png'
            ? 'image/png'
            : extension === 'jpg' || extension === 'jpeg'
              ? 'image/jpeg'
              : extension === 'pdf'
                ? 'application/pdf'
                : extension === 'wav'
                  ? 'audio/wav'
                  : '';
        if (!file || !file.path || !fileType) {
          this.setData({
            error: '当前真实音频入口只支持 WAV；同时支持 PNG/JPEG 图片或 PDF 文件。',
          });
          return;
        }
        this.setData({ filePath: file.path, fileName: name, fileType, error: '' });
      },
      fail: (error) => {
        if (error && error.errMsg && error.errMsg.indexOf('cancel') >= 0) return;
        this.setData({ error: '文件选择失败，请重试。' });
      },
    });
  },
  onManualTitle(event) {
    this.setData({ manualTitle: event.detail.value });
  },
  onManualDueAt(event) {
    this.setData({ manualDueAt: event.detail.value });
  },
  submit() {
    if (!this.data.text.trim() && !this.data.filePath) {
      this.setData({ error: '请先粘贴通知原文，或选择 PNG/JPEG/PDF/WAV 文件。' });
      return;
    }
    this.setData({ loading: true, error: '' });
    if (this.data.filePath && this.data.fileType === 'audio/wav') {
      api
        .uploadAudioDocument(this.data.filePath, this.data.fileType, this.data.fileName)
        .then((result) =>
          wx.redirectTo({
            url: `/pages/parse/parse?jobId=${result.parse_job.parse_job_id}&audioId=${result.audio.audio_id}`,
          }),
        )
        .catch((error) =>
          this.setData({
            loading: false,
            error:
              error && error.error && error.error.code === 'NETWORK_ERROR'
                ? '导入失败，请检查 API 地址与网络。'
                : '语音识别失败，请确认 WAV 文件与本地识别服务可用。',
          }),
        );
      return;
    }
    api[this.data.filePath ? 'uploadMediaDocument' : 'createDocument'](
      ...(this.data.filePath
        ? [this.data.filePath, this.data.fileType, this.data.fileName]
        : [this.data.text]),
    )
      .then((result) => {
        const documentId = result.document.document_id;
        this.setData({ documentId });
        return api.parseDocument(documentId);
      })
      .then((job) => {
        if (job.status === 'failed') {
          this.setData({
            loading: false,
            canManual: true,
            error: '解析失败，原文已保留；你仍可人工创建任务。',
          });
          return;
        }
        wx.redirectTo({ url: `/pages/parse/parse?jobId=${job.parse_job_id}` });
      })
      .catch((error) =>
        this.setData({
          loading: false,
          canManual: Boolean(this.data.documentId),
          error: this.data.documentId
            ? '解析失败，原文已保留；你仍可人工创建任务。'
            : error && error.error && error.error.code === 'NETWORK_ERROR'
              ? '导入失败，请检查 API 地址与网络。'
              : '导入失败，请稍后重试。',
        }),
      );
  },
  manualCreate() {
    const title = (this.data.manualTitle || '').trim();
    if (!this.data.documentId || !title) {
      this.setData({ error: '请填写人工任务标题。' });
      return;
    }
    this.setData({ loading: true, error: '' });
    api
      .createManualTask(this.data.documentId, title, (this.data.manualDueAt || '').trim())
      .then(() => {
        wx.showToast({ title: '人工任务已创建', icon: 'success' });
        wx.navigateTo({ url: '/pages/tasks/tasks' });
      })
      .catch(() => this.setData({ loading: false, error: '人工任务创建失败，请确认后重试。' }));
  },
});

