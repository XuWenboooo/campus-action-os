const api = require('../../utils/api');

Page({
  data: { action: null, sourceText: '', evidence: [], selected: '', error: '' },
  onLoad(options) {
    api.getEvidence(options.actionId).then((result) => {
      this.setData({ action: result.action, sourceText: result.source_text, evidence: result.action.evidence || [], selected: result.action.evidence[0] && result.action.evidence[0].evidence_id });
    }).catch(() => this.setData({ error: '原文证据读取失败。' }));
  },
  selectEvidence(event) { this.setData({ selected: event.currentTarget.dataset.id }); },
});
