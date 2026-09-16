App({
  globalData: {
    apiBaseUrl: 'http://127.0.0.1:3000',
    userId: 'dev-user',
    // Real API is the default integration path. Demo fixtures remain available
    // only when a developer explicitly opts into mock mode.
    useMock: false,
    demoMode: false,
  },
  onLaunch() {
    const storedUserId = wx.getStorageSync('devUserId');
    if (storedUserId) this.globalData.userId = storedUserId;
  },
});
