function appConfig() {
  const app = getApp();
  return {
    baseUrl: (app && app.globalData.apiBaseUrl) || 'http://127.0.0.1:3000',
    userId: (app && app.globalData.userId) || 'dev-user',
    useMock: Boolean(app && app.globalData.useMock),
    demoMode: Boolean(app && app.globalData.demoMode),
  };
}

function apiError(code, message, details) {
  return { error: { code, message, details } };
}

function unsupportedRealCapability(capability) {
  return Promise.reject(
    apiError(
      'REAL_API_NOT_AVAILABLE',
      `${capability} 当前没有可用的学生端真实 API。`,
      { capability },
    ),
  );
}

function displayDeadline(value) {
  if (!value) return '待确认';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function enrichTask(task, action) {
  const dueAt = task.due_at ? new Date(task.due_at) : null;
  const now = new Date();
  const today = dueAt && dueAt.toDateString() === now.toDateString();
  const horizon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  return {
    ...task,
    action,
    home_bucket: today ? 'today' : dueAt && dueAt > now && dueAt <= horizon ? 'upcoming' : 'later',
    due_display: displayDeadline(task.due_at),
    source: '通知原文',
    platform: action && action.platform && action.platform.value ? action.platform.value : '待确认',
  };
}

function changeTypeLabel(changeType) {
  if (changeType === 'postponed') return '截止时间延期，待确认';
  if (changeType === 'revoked') return '通知撤回，待确认';
  return '通知内容发生变化，待确认';
}

function request(path, options) {
  const config = appConfig();
  const input = options || {};
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${config.baseUrl}${path}`,
      method: input.method || 'GET',
      data: input.data,
      header: {
        'content-type': 'application/json',
        'x-dev-user-id': config.userId,
        ...(input.idempotencyKey ? { 'Idempotency-Key': input.idempotencyKey } : {}),
      },
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data);
          return;
        }
        reject(response.data || { error: { code: 'HTTP_ERROR', message: 'Request failed' } });
      },
      fail(error) {
        reject(apiError('NETWORK_ERROR', '无法连接真实 API。', error));
      },
    });
  });
}

function key(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

module.exports = {
  getTasks() {
    if (appConfig().useMock) return require('./mock').getTasks();
    return request('/tasks').then((result) =>
      Promise.all(
        (result.tasks || []).map((task) =>
          request(`/actions/${task.action_id}`).then((actionResult) => enrichTask(task, actionResult.action)),
        ),
      ).then((tasks) => ({ ...result, tasks })),
    );
  },
  getPendingChanges() {
    if (appConfig().useMock) return require('./mock').getPendingChanges();
    return this.getTasks().then(({ tasks }) =>
      Promise.all(
        tasks.map((task) =>
          request(`/tasks/${task.task_id}/notice-sync`).then((result) =>
            (result.sync || [])
              .filter((event) => event.status === 'pending_review')
              .map((event) => ({
                change_event_id: event.sync_event_id,
                sync_event_id: event.sync_event_id,
                task_id: task.task_id,
                task_title: task.title,
                change_label: changeTypeLabel(event.change_type),
                old_value: '',
                new_value: '',
                source: '关联通知',
                status: 'pending',
                change_type: event.change_type,
              })),
          ),
        ),
      ).then((groups) => ({ changes: groups.reduce((all, group) => all.concat(group), []) })),
    );
  },
  getOrchestrationSummary() {
    if (appConfig().useMock) return require('./mock').getOrchestrationSummary();
    return unsupportedRealCapability('行动编排');
  },
  getOrchestrationResult() {
    if (appConfig().useMock) return require('./mock').getOrchestrationResult();
    return unsupportedRealCapability('行动编排');
  },
  resetDemoState() {
    if (appConfig().useMock) return require('./mock').resetDemoState();
    return unsupportedRealCapability('Demo 状态重置');
  },
  enterDemoScenario(name) {
    if (appConfig().useMock) return require('./mock').enterDemoScenario(name);
    return unsupportedRealCapability('Demo 场景');
  },
  getDemoState() {
    if (appConfig().useMock) return require('./mock').getDemoState();
    return unsupportedRealCapability('Demo 状态读取');
  },
  createDocument(text) {
    if (appConfig().useMock) return require('./mock').createDocument(text);
    return request('/documents', {
      method: 'POST',
      idempotencyKey: key('document'),
      data: { title: '微信导入通知', text, data_origin: 'user_provided' },
    });
  },
  uploadMediaDocument(filePath, contentType, title) {
    if (appConfig().useMock) return require('./mock').uploadMediaDocument(filePath, contentType, title);
    return new Promise((resolve, reject) => {
      wx.getFileSystemManager().readFile({
        filePath,
        encoding: 'base64',
        success(file) {
          request('/documents/upload', {
            method: 'POST',
            idempotencyKey: key('document-upload'),
            data: {
              title: title || '微信导入通知',
              contentType,
              content_base64: file.data,
              data_origin: 'user_provided',
            },
          }).then(resolve, reject);
        },
        fail: reject,
      });
    });
  },
  parseDocument(documentId) {
    if (appConfig().useMock) return require('./mock').parseDocument(documentId);
    return request(`/documents/${documentId}/parse`, {
      method: 'POST',
      idempotencyKey: key('parse'),
      data: {},
    });
  },
  getParseJob(parseJobId) {
    if (appConfig().useMock) return require('./mock').getParseJob(parseJobId);
    return request(`/parse-jobs/${parseJobId}`);
  },
  confirmAction(actionId) {
    if (appConfig().useMock) return require('./mock').confirmAction(actionId);
    return request(`/actions/${actionId}/confirm`, {
      method: 'POST',
      idempotencyKey: key('confirm'),
      data: { confirmed: true },
    });
  },
  rejectAction(actionId) {
    if (appConfig().useMock) return require('./mock').rejectAction(actionId);
    return request(`/actions/${actionId}/reject`, {
      method: 'POST',
      idempotencyKey: key('reject'),
      data: { rejected: true },
    });
  },
  createTask(actionId) {
    if (appConfig().useMock) return require('./mock').createTask(actionId);
    return request('/tasks', {
      method: 'POST',
      idempotencyKey: key('task'),
      data: { actionId },
    });
  },
  createManualTask(documentId, title, dueAt) {
    if (appConfig().useMock) return require('./mock').createManualTask(documentId, title, dueAt);
    return request('/tasks/manual', {
      method: 'POST',
      idempotencyKey: key('manual-task'),
      data: { documentId, title, due_at: dueAt || null, confirmed: true },
    });
  },
  linkTaskNotice(taskId, noticeId) {
    if (appConfig().useMock) return Promise.resolve({ ok: true, taskId, noticeId });
    return request(`/tasks/${taskId}/notices`, {
      method: 'POST',
      idempotencyKey: key('task-notice-link'),
      data: { noticeId, confirmed: true },
    });
  },
  getTaskNoticeSync(taskId) {
    if (appConfig().useMock) return Promise.resolve({ sync: [] });
    return request(`/tasks/${taskId}/notice-sync`);
  },
  resolveTaskNoticeSync(taskId, syncEventId, decision) {
    if (appConfig().useMock) return Promise.resolve({ ok: true, taskId, syncEventId, decision });
    return request(`/tasks/${taskId}/notice-sync/${syncEventId}/resolve`, {
      method: 'POST',
      idempotencyKey: key('task-notice-sync'),
      data: { decision, confirmed: true },
    });
  },
  completeTask(taskId) {
    if (appConfig().useMock) return require('./mock').completeTask(taskId);
    return request(`/tasks/${taskId}/complete`, {
      method: 'POST',
      idempotencyKey: key('complete'),
      data: { confirmed: true },
    });
  },
  getProfile() {
    if (appConfig().useMock) return require('./mock').getProfile();
    return request('/users/me');
  },
  exportUserData() {
    if (appConfig().useMock) return require('./mock').exportUserData();
    return request('/users/me/export');
  },
  updateProfile(data) {
    if (appConfig().useMock) return require('./mock').updateProfile(data);
    return request('/users/me/profile', {
      method: 'PATCH',
      idempotencyKey: key('profile'),
      data,
    });
  },
  getAction(actionId) {
    if (appConfig().useMock) return require('./mock').getAction(actionId);
    return request(`/actions/${actionId}`);
  },
  getEvidence(actionId) {
    if (appConfig().useMock) return require('./mock').getEvidence(actionId);
    return request(`/actions/${actionId}`).then((result) => ({
      action: result.action,
      source_text: (result.action.evidence || []).map((item) => item.source_text).filter(Boolean).join('\n'),
    }));
  },
  getTask(taskId) {
    if (appConfig().useMock) return require('./mock').getTask(taskId);
    return request(`/tasks/${taskId}`).then((result) =>
      request(`/actions/${result.task.action_id}`).then((actionResult) => ({
        ...result,
        task: enrichTask(result.task, actionResult.action),
        action: actionResult.action,
      })),
    );
  },
  getNotificationDiff(changeEventId) {
    if (appConfig().useMock) return require('./mock').getNotificationDiff(changeEventId);
    if (!this._diffTaskId || !changeEventId) return unsupportedRealCapability('通知变化详情');
    return request(`/tasks/${this._diffTaskId}/notice-sync`).then((result) => {
      const event = (result.sync || []).find((item) => item.sync_event_id === changeEventId);
      if (!event) return Promise.reject(apiError('SYNC_EVENT_NOT_FOUND', '待处理的通知变化不存在。'));
      return {
        ...event,
        change_event_id: event.sync_event_id,
        task_id: this._diffTaskId,
        title: '关联通知发生变化',
        source: '关联通知',
        fields: [],
        impacts: [],
        details_available: false,
      };
    });
  },
  applyNotificationDiff(changeEventId) {
    if (appConfig().useMock) return require('./mock').applyNotificationDiff(changeEventId);
    if (!this._diffTaskId || !changeEventId) return unsupportedRealCapability('通知变化更新');
    return this.resolveTaskNoticeSync(this._diffTaskId, changeEventId, 'accept');
  },
  dismissNotificationDiff(changeEventId) {
    if (appConfig().useMock) return require('./mock').dismissNotificationDiff(changeEventId);
    return this.resolveTaskNoticeSync(this._diffTaskId, changeEventId, 'reject');
  },
  getDemoScenario(name) {
    if (appConfig().useMock) return require('./mock').getDemoScenario(name);
    return unsupportedRealCapability('Demo 示例通知');
  },
  setDiffContext(taskId) {
    this._diffTaskId = taskId;
  },
  isDemoMode() {
    return appConfig().useMock && appConfig().demoMode;
  },
};
