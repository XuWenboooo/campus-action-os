const api = require('../../utils/api');

function settle(promise) {
  return promise.then((value) => ({ status: 'fulfilled', value }), (reason) => ({ status: 'rejected', reason }));
}

Page({
  data: { tasks: [], todayTasks: [], upcomingTasks: [], changedTasks: [], orchestrationSuggestion: null, conflictAlert: null, changesUnavailable: false, demoMode: api.isDemoMode(), error: '', loading: true },
  onShow() {
    this.setData({ loading: true });
    Promise.all([settle(api.getTasks()), settle(api.getPendingChanges()), settle(api.getOrchestrationSummary())]).then((results) => {
      const taskResult = results[0];
      const changeResult = results[1];
      const orchestrationResult = results[2];
      const tasks = taskResult.status === 'fulfilled' ? taskResult.value.tasks || [] : [];
      const changes = changeResult.status === 'fulfilled' ? changeResult.value.changes || [] : [];
      const taskError = taskResult.status === 'rejected';
      const changesUnavailable = changeResult.status === 'rejected';
      const orchestration = orchestrationResult.status === 'fulfilled' ? orchestrationResult.value : {};
      this.setData({
        tasks,
        todayTasks: tasks.filter((task) => task.home_bucket === 'today' && task.status !== 'completed'),
        upcomingTasks: tasks.filter((task) => task.home_bucket === 'upcoming' && task.status !== 'completed'),
        changedTasks: changes,
        changesUnavailable,
        orchestrationSuggestion: orchestration.suggestion || null,
        conflictAlert: orchestration.conflict || null,
        error: taskError ? '任务加载失败，请稍后重试。' : '',
        loading: false,
      });
    });
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
    const taskId = event && event.currentTarget && event.currentTarget.dataset.taskId;
    wx.navigateTo({ url: `/pages/diff/diff${changeEventId ? `?changeEventId=${changeEventId}&taskId=${taskId || ''}` : ''}` });
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
