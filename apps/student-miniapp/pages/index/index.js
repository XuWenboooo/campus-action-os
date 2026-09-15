const api = require('../../utils/api');

Page({
  data: { tasks: [], todayTasks: [], upcomingTasks: [], changedTasks: [], error: '', loading: true },
  onShow() {
    this.setData({ loading: true });
    api
      .getTasks()
      .then((result) => {
        const tasks = result.tasks || [];
        this.setData({ tasks, todayTasks: tasks.filter((task) => ['task-student', 'task-orientation'].includes(task.task_id) && task.status !== 'completed'), upcomingTasks: tasks.filter((task) => task.task_id === 'task-scholarship' && task.status !== 'completed'), changedTasks: tasks.filter((task) => task.status === 'changed'), error: '', loading: false });
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
  openDiff() {
    wx.navigateTo({ url: '/pages/diff/diff' });
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
