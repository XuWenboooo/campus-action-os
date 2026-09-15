App({
  globalData: {
    apiBaseUrl: 'http://127.0.0.1:3000',
    userId: 'dev-user',
    // Demo mode is intentionally enabled for the local front-end MVP. Toggle this
    // flag off when the integration environment is ready.
    useMock: true,
    demoMode: true,
  },
  onLaunch() {
    const storedUserId = wx.getStorageSync('devUserId');
    if (storedUserId) this.globalData.userId = storedUserId;
  },
});
