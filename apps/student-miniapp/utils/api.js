function appConfig() {
  const app = getApp();
  return {
    baseUrl: (app && app.globalData.apiBaseUrl) || 'http://127.0.0.1:3000',
    userId: (app && app.globalData.userId) || 'dev-user',
    useMock: Boolean(app && app.globalData.useMock),
  };
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
      fail: reject,
    });
  });
}

function key(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

module.exports = {
  getTasks() {
    if (appConfig().useMock) return require('./mock').getTasks();
    return request('/tasks');
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
    return request(`/actions/${actionId}/evidence`);
  },
  getTask(taskId) {
    if (appConfig().useMock) return require('./mock').getTask(taskId);
    return request(`/tasks/${taskId}`);
  },
  getNotificationDiff() {
    if (appConfig().useMock) return require('./mock').getNotificationDiff();
    return request('/notifications/diff');
  },
  applyNotificationDiff() {
    if (appConfig().useMock) return require('./mock').applyNotificationDiff();
    return request('/notifications/diff/apply', { method: 'POST', idempotencyKey: key('notification-diff'), data: { confirmed: true } });
  },
  getDemoScenario(name) {
    if (appConfig().useMock) return require('./mock').getDemoScenario(name);
    return Promise.resolve({ label: name, source: '' });
  },
};
