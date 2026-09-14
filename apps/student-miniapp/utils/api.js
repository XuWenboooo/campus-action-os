function appConfig() {
  const app = getApp();
  return {
    baseUrl: (app && app.globalData.apiBaseUrl) || 'http://127.0.0.1:3000',
    userId: (app && app.globalData.userId) || 'dev-user',
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
    return request('/tasks');
  },
  createDocument(text) {
    return request('/documents', {
      method: 'POST',
      idempotencyKey: key('document'),
      data: { title: '微信导入通知', text, data_origin: 'user_provided' },
    });
  },
  parseDocument(documentId) {
    return request(`/documents/${documentId}/parse`, {
      method: 'POST',
      idempotencyKey: key('parse'),
      data: {},
    });
  },
  getParseJob(parseJobId) {
    return request(`/parse-jobs/${parseJobId}`);
  },
  confirmAction(actionId) {
    return request(`/actions/${actionId}/confirm`, {
      method: 'POST',
      idempotencyKey: key('confirm'),
      data: { confirmed: true },
    });
  },
  rejectAction(actionId) {
    return request(`/actions/${actionId}/reject`, {
      method: 'POST',
      idempotencyKey: key('reject'),
      data: { rejected: true },
    });
  },
  createTask(actionId) {
    return request('/tasks', {
      method: 'POST',
      idempotencyKey: key('task'),
      data: { actionId },
    });
  },
  completeTask(taskId) {
    return request(`/tasks/${taskId}/complete`, {
      method: 'POST',
      idempotencyKey: key('complete'),
      data: { confirmed: true },
    });
  },
  getProfile() {
    return request('/users/me');
  },
  updateProfile(data) {
    return request('/users/me/profile', { method: 'PATCH', data });
  },
};
