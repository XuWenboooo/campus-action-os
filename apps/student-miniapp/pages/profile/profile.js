const api = require('../../utils/api');

Page({
  data: { educationLevel: '', loading: false, error: '' },
  onLoad() {
    api
      .getProfile()
      .then((result) => this.setData({ educationLevel: result.profile.education_level || '' }))
      .catch(() => this.setData({ error: '画像读取失败。' }));
  },
  onEducationInput(event) {
    this.setData({ educationLevel: event.detail.value });
  },
  save() {
    this.setData({ loading: true, error: '' });
    api
      .updateProfile({ education_level: this.data.educationLevel })
      .then(() => wx.showToast({ title: '已保存', icon: 'success' }))
      .catch(() => this.setData({ error: '画像保存失败。' }))
      .finally(() => this.setData({ loading: false }));
  },
});
