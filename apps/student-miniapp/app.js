App({
  globalData: {
    apiBaseUrl: 'http://127.0.0.1:3000',
    userId: 'dev-user',
  },
  onLaunch() {
    const storedUserId = wx.getStorageSync('devUserId');
    if (storedUserId) this.globalData.userId = storedUserId;
  },
});
