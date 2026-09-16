const api = require('../../utils/api');

const labels = {
  target_population: '受众',
  steps: '行动',
  conditions: '条件',
  deadline: '截止时间',
  platform: '平台',
  required_materials: '所需材料',
};

Page({
  data: { action: null, sourceText: '', evidence: [], selected: '', error: '' },
  onLoad(options) {
    api.getEvidence(options.actionId).then((result) => {
      const evidence = (result.action.evidence || []).map((item) => ({ ...item, label: labels[item.field_name] || item.field_name, type: item.field_name }));
      this.setData({ action: result.action, sourceText: result.source_text, evidence, selected: evidence[0] && evidence[0].evidence_id });
    }).catch(() => this.setData({ error: '原文证据读取失败。' }));
  },
  selectEvidence(event) { this.setData({ selected: event.currentTarget.dataset.id }); },
});
