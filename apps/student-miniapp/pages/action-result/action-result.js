const api = require('../../utils/api');

function displayDeadline(value) {
  if (!value) return '待确认';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function actionView(action) {
  if (!action) return null;
  const deadline = action.deadline || {};
  const claimValue = (claim) => (claim && claim.value ? claim.value : '');
  return {
    deadline: deadline.display || displayDeadline(deadline.value),
    platform: claimValue(action.platform) || action.platform || '待确认',
    audience: (action.target_population || []).join('、') || action.audience || '待确认',
    condition:
      (action.conditions || []).map((item) => item.statement || item).join('；') ||
      action.condition ||
      '无额外条件',
    materials:
      (action.required_materials || []).map((item) => item.description || item).join('、') ||
      action.materials ||
      '无',
    steps: (action.steps || []).map((item) => item.instruction || item),
    statusLabel:
      action.verification_status === 'user_confirmation_required'
        ? '有信息需要你确认'
        : '已根据通知编译',
    statusTone: action.verification_status === 'user_confirmation_required' ? 'orange' : 'green',
  };
}

Page({
  data: {
    action: null,
    actionView: null,
    extraActions: [],
    assessment: null,
    sourceText: '',
    loading: true,
    creating: false,
    error: '',
    orchestration: false,
    orchestrationActions: [],
    relations: [],
    prioritySuggestion: null,
    conflicts: [],
    changeImpacts: [],
  },
  onLoad(options) {
    this.jobId = options.jobId;
    this.audioId = options.audioId || '';
    const loader =
      options && options.orchestration ? api.getOrchestrationResult() : api.getParseJob(this.jobId);
    loader
      .then((payload) => {
        const result = payload.result || payload || {};
        const action = (result.verified_actions || [])[0];
        this.setData({
          action,
          actionView: actionView(action),
          extraActions: (result.verified_actions || []).slice(1),
          assessment: result.document_assessment,
          sourceText:
            result.source_text ||
            (action && action.evidence && action.evidence[0] && action.evidence[0].source_text) ||
            '',
          loading: false,
          orchestration: Boolean(result.orchestration),
          orchestrationActions: result.orchestration_actions || result.verified_actions || [],
          relations: result.relations || [],
          prioritySuggestion: result.priority_suggestion || null,
          conflicts: result.conflicts || [],
          changeImpacts: result.change_impacts || [],
        });
      })
      .catch(() => this.setData({ loading: false, error: '行动结果读取失败，请重试。' }));
  },
  openEvidence() {
    if (this.data.action)
      wx.navigateTo({ url: `/pages/evidence/evidence?actionId=${this.data.action.action_id}` });
  },
  openGraphEvidence(event) {
    const actionId = event.currentTarget.dataset.id;
    if (actionId) wx.navigateTo({ url: `/pages/evidence/evidence?actionId=${actionId}` });
  },
  openConflictEvidence() {
    wx.navigateTo({ url: '/pages/evidence/evidence?actionId=action-conflict' });
  },
  createTask() {
    if (!this.data.action) return;
    this.setData({ creating: true, error: '' });
    const actions = [this.data.action].concat(this.data.extraActions || []);
    Promise.all(actions.map((action) => api.confirmAction(action.action_id)))
      .then(() => Promise.all(actions.map((action) => api.createTask(action.action_id))))
      .then((results) => {
        const result = results[0];
        wx.showToast({ title: '任务已创建', icon: 'success' });
        setTimeout(
          () =>
            wx.navigateTo({ url: `/pages/task-detail/task-detail?taskId=${result.task.task_id}` }),
          500,
        );
      })
      .catch(() => this.setData({ error: '任务创建失败，请重试。' }))
      .finally(() => this.setData({ creating: false }));
  },
  reject() {
    api.rejectAction(this.data.action.action_id).then(() => {
      wx.showToast({ title: '已移除', icon: 'success' });
      wx.navigateBack();
    });
  },
});

