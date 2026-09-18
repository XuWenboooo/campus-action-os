// 学生端宿主 · API 边界调用封装
// 约束：客户端只调用 API 服务；模型密钥保存在服务端，绝不进入小程序包。

function buildUrl(baseUrl, path) {
  var base = (baseUrl || '').replace(/\/+$/, '');
  return base + path;
}

/**
 * 探测 API 边界的健康检查端点。
 * 无论成功失败都 resolve，避免首屏被网络异常阻塞。
 */
function probeHealth(baseUrl) {
  return new Promise(function (resolve) {
    wx.request({
      url: buildUrl(baseUrl, '/health'),
      method: 'GET',
      timeout: 4000,
      success: function (res) {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          statusCode: res.statusCode,
          data: res.data,
        });
      },
      fail: function (err) {
        resolve({
          ok: false,
          statusCode: 0,
          error: (err && err.errMsg) || 'request failed',
        });
      },
    });
  });
}

/** 读取 API 能力清单（M2 文本接口边界）。 */
function fetchCapabilities(baseUrl) {
  return new Promise(function (resolve) {
    wx.request({
      url: buildUrl(baseUrl, '/v1/capabilities'),
      method: 'GET',
      timeout: 4000,
      success: function (res) {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          statusCode: res.statusCode,
          data: res.data,
        });
      },
      fail: function (err) {
        resolve({ ok: false, statusCode: 0, error: (err && err.errMsg) || 'request failed' });
      },
    });
  });
}

module.exports = {
  probeHealth: probeHealth,
  fetchCapabilities: fetchCapabilities,
};
