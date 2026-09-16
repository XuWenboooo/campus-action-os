const api = require('../../utils/api');

Page({
  data: { tasks: [], todayTasks: [], upcomingTasks: [], changedTasks: [], orchestrationSuggestion: null, conflictAlert: null, error: '', loading: true },
  onShow() {
    this.setData({ loading: true });
    Promise.all([api.getTasks(), api.getPendingChanges(), api.getOrchestrationSummary()])
      .then(([taskResult, changeResult, orchestration]) => {
        const tasks = taskResult.tasks || [];
        const changes = changeResult.changes || [];
        this.setData({ tasks, todayTasks: tasks.filter((task) => task.home_bucket === 'today' && task.status !== 'completed'), upcomingTasks: tasks.filter((task) => task.home_bucket === 'upcoming' && task.status !== 'completed'), changedTasks: changes, orchestrationSuggestion: orchestration.suggestion || null, conflictAlert: orchestration.conflict || null, error: '', loading: false });
      })
      .catch(() => this.setData({ error: '任务加载失败，请稍后重试。', loading: false }));
  },
  openImport() {
    wx.navigateTo({ url: '/pages/import/import' });
  },
  openTasks() {
    wx.navigateTo({ url: '/pages/tasks/tasks' });
  },
  openTask(event) {
    wx.navigateTo({ url: `/pages/task-detail/task-detail?taskId=${event.currentTarget.dataset.id}` });
  },
  openDiff(event) {
    const changeEventId = event && event.currentTarget && event.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/diff/diff${changeEventId ? `?changeEventId=${changeEventId}` : ''}` });
  },
  openOrchestration() {
    wx.navigateTo({ url: '/pages/action-result/action-result?orchestration=demo-d' });
  },
  openConflict() {
    wx.navigateTo({ url: '/pages/evidence/evidence?actionId=action-conflict' });
  },
  openDemo(event) {
    wx.navigateTo({ url: `/pages/import/import?scenario=${event.currentTarget.dataset.scenario}` });
  },
  openProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' });
  },
  openSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' });
  },
});
