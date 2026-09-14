const api = require('../../utils/api');

Page({
  data: { tasks: [], error: '', loadingTaskId: '' },
  onShow() {
    api
      .getTasks()
      .then((result) => {
        const tasks = result.tasks || [];
        return Promise.all(
          tasks.map((task) =>
            api
              .getTaskNoticeSync(task.task_id)
              .then((sync) => {
                const links = sync.sync || [];
                return {
                  ...task,
                  pendingSync: links.flatMap((link) =>
                    (link.events || []).filter((event) => event.status === 'pending_review'),
                  ),
                  noticeIdInput: '',
                };
              })
              .catch(() => ({ ...task, pendingSync: [], noticeIdInput: '' })),
          ),
        );
      })
      .then((tasks) => this.setData({ tasks, error: '' }))
      .catch(() => this.setData({ error: '任务加载失败。' }));
  },
  onNoticeInput(event) {
    const index = event.currentTarget.dataset.index;
    this.setData({ [`tasks[${index}].noticeIdInput`]: event.detail.value });
  },
  linkNotice(event) {
    const index = event.currentTarget.dataset.index;
    const task = this.data.tasks[index];
    const noticeId = (task.noticeIdInput || '').trim();
    if (!noticeId) {
      this.setData({ error: '请先输入已发布通知 ID。' });
      return;
    }
    api
      .linkTaskNotice(task.task_id, noticeId)
      .then(() => {
        wx.showToast({ title: '通知已关联', icon: 'success' });
        this.onShow();
      })
      .catch(() => this.setData({ error: '通知关联失败，请确认通知已发布且任务属于当前用户。' }));
  },
  completeTask(event) {
    const index = event.currentTarget.dataset.index;
    const task = this.data.tasks[index];
    if (!task || !['pending', 'in_progress'].includes(task.status)) return;
    wx.showModal({
      title: '确认完成任务',
      content: `确认已完成“${task.title}”吗？完成后只能保留已完成状态。`,
      confirmText: '确认完成',
      success: (result) => {
        if (!result.confirm) return;
        this.setData({ loadingTaskId: task.task_id, error: '' });
        api
          .completeTask(task.task_id)
          .then(() => {
            wx.showToast({ title: '任务已完成', icon: 'success' });
            this.onShow();
          })
          .catch(() => this.setData({ error: '任务完成失败，请确认后重试。' }))
          .finally(() => this.setData({ loadingTaskId: '' }));
      },
    });
  },
  resolveSync(event) {
    const taskId = event.currentTarget.dataset.taskId;
    const syncEventId = event.currentTarget.dataset.eventId;
    const decision = event.currentTarget.dataset.decision;
    api
      .resolveTaskNoticeSync(taskId, syncEventId, decision)
      .then(() => {
        wx.showToast({
          title: decision === 'accept' ? '变更已接受' : '变更已拒绝',
          icon: 'success',
        });
        this.onShow();
      })
      .catch(() => this.setData({ error: '通知变更处理失败，请确认后重试。' }));
  },
});
