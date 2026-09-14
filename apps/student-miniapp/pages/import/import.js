const api = require('../../utils/api');

Page({
  data: { text: '', loading: false, error: '' },
  onInput(event) {
    this.setData({ text: event.detail.value });
  },
  submit() {
    if (!this.data.text.trim()) {
      this.setData({ error: '请先输入通知原文。' });
      return;
    }
    this.setData({ loading: true, error: '' });
    api
      .createDocument(this.data.text)
      .then((result) => api.parseDocument(result.document.document_id))
      .then((job) => {
        wx.redirectTo({ url: `/pages/parse/parse?jobId=${job.parse_job_id}` });
      })
      .catch(() =>
        this.setData({ loading: false, error: '导入或解析失败，请查看错误详情后重试。' }),
      );
  },
});
