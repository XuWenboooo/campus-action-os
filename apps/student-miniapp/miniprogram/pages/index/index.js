var demo = require('../../utils/demo-graph.js');
var api = require('../../utils/api.js');

Page({
  data: {
    apiBaseUrl: '',
    hostStage: '',
    statusRows: [],
    noticeText: '',
    probing: false,
    probeText: '',
    probeState: '',
    hasGraph: false,
    graph: null,
    principles: [
      '字段级原文证据',
      'Action Graph，而非单一待办清单',
      '关键不确定性必须要求用户确认',
      '所有具备副作用的行为都需用户明确确认',
    ],
  },

  onLoad: function () {
    var app = getApp();
    this.setData({
      apiBaseUrl: app.globalData.apiBaseUrl,
      hostStage: app.globalData.hostStage,
      noticeText: demo.SAMPLE_NOTICE,
      statusRows: [
        { key: 'host', label: '小程序宿主', value: '已运行', state: 'ok' },
        { key: 'proto', label: '共享协议包', value: 'v1', state: 'ok' },
        { key: 'm2', label: 'M2 文本接口契约', value: '已冻结', state: 'ok' },
        { key: 'ai', label: '真实 AI 解析', value: '未接入', state: 'off' },
        { key: 'db', label: '数据库', value: '未接入', state: 'off' },
        { key: 'biz', label: '业务页面', value: '未实现', state: 'pending' },
      ],
    });
    console.log('[Campus Action OS] index 页面加载完成');
  },

  onNoticeInput: function (e) {
    this.setData({ noticeText: e.detail.value });
  },

  onResetSample: function () {
    this.setData({ noticeText: demo.SAMPLE_NOTICE });
    wx.showToast({ title: '已恢复示例通知', icon: 'none' });
  },

  onGenerateGraph: function () {
    var text = (this.data.noticeText || '').trim();
    if (!text) {
      wx.showToast({ title: '请先输入通知文本', icon: 'none' });
      return;
    }
    var graph = demo.buildDemoGraph();
    this.setData({ graph: graph, hasGraph: true });
    wx.showToast({ title: '已生成演示行动图', icon: 'none' });
  },

  onProbe: function () {
    var self = this;
    this.setData({ probing: true, probeText: '', probeState: '' });
    api.probeHealth(this.data.apiBaseUrl).then(function (res) {
      var text = '';
      var state = 'fail';
      if (res.ok) {
        state = 'ok';
        text = 'HTTP ' + res.statusCode + ' · 响应 ' + self._short(res.data);
      } else if (res.statusCode) {
        text = 'HTTP ' + res.statusCode + ' · 服务已响应但状态异常';
      } else {
        text = '未连接：' + res.error;
      }
      self.setData({ probing: false, probeText: text, probeState: state });
    });
  },

  _short: function (data) {
    var text = '';
    try {
      text = typeof data === 'string' ? data : JSON.stringify(data);
    } catch (err) {
      text = String(data);
    }
    return text.length > 160 ? text.slice(0, 160) + '…' : text;
  },
});
