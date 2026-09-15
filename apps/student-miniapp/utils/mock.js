const STORAGE_KEY = 'campusActionMockState';

const scenarios = {
  student: {
    label: '学籍核验',
    source: '关于开展2026届本科毕业生学籍信息核验的通知\n请所有2026届本科毕业生于9月15日前登录学信网完成学籍信息核验。请仔细核对本人学籍信息，如有问题请联系教务处。',
    assessment: { user_relevance: 'relevant', relevance_reason: '你的画像为2026届本科生，与通知对象一致。', confidence: 'high' },
    actions: [{ action_id: 'action-student', title: '完成学籍信息核验', deadline: { value: '2026-09-15T23:59:00+08:00', display: '9 月 15 日 23:59' }, platform: '学信网', materials: '本人学籍信息', audience: '2026届本科毕业生', condition: '仅适用于2026届本科毕业生', source: '教务处通知', steps: ['登录学信网', '核对并确认本人学籍信息'], evidence: [{ evidence_id: 'ev-student-audience', type: 'audience', label: '适用对象', source_text: '所有2026届本科毕业生' }, { evidence_id: 'ev-student-deadline', type: 'deadline', label: '截止时间', source_text: '9月15日前' }, { evidence_id: 'ev-student-action', type: 'action', label: '行动', source_text: '登录学信网完成学籍信息核验' }] }],
  },
  scholarship: {
    label: '国家奖学金',
    source: '关于开展2025—2026学年国家奖学金评审工作的通知\n符合条件的本科生请于9月18日17:00前提交申请表、成绩单和获奖证书至学院初审。学院审核通过后，登录奖助系统完成线上确认。',
    assessment: { user_relevance: 'relevant', relevance_reason: '这是面向本科生的奖学金申报，你可以申请。', confidence: 'medium' },
    actions: [{ action_id: 'action-scholarship', title: '提交国家奖学金申请材料', deadline: { value: '2026-09-18T17:00:00+08:00', display: '9 月 18 日 17:00' }, platform: '学院初审 / 奖助系统', materials: '申请表、成绩单、获奖证书', audience: '符合条件的本科生', condition: '需满足国家奖学金评审条件', source: '学生资助管理中心', steps: ['下载并填写申请表', '准备成绩单与获奖证书', '提交学院初审', '审核通过后完成线上确认'], evidence: [{ evidence_id: 'ev-scholarship-audience', type: 'audience', label: '适用对象', source_text: '符合条件的本科生' }, { evidence_id: 'ev-scholarship-deadline', type: 'deadline', label: '截止时间', source_text: '9月18日17:00前' }, { evidence_id: 'ev-scholarship-materials', type: 'materials', label: '所需材料', source_text: '申请表、成绩单和获奖证书' }] }],
  },
  extension: {
    label: '延期通知',
    source: '关于延长大学生创新训练项目申报时间的补充通知\n因系统维护，原定于9月15日23:59截止的申报，现延期至9月18日23:59。新增材料：学生证和成绩单。',
    assessment: { user_relevance: 'relevant', relevance_reason: '这条补充通知更新了你正在进行的项目申报任务。', confidence: 'high' },
    actions: [{ action_id: 'action-extension', title: '完成大学生创新训练项目申报', deadline: { value: '2026-09-18T23:59:00+08:00', display: '9 月 18 日 23:59' }, platform: '创新训练项目系统', materials: '学生证、成绩单', audience: '已参与项目申报的学生', condition: '原任务截止时间已变更', source: '教务处补充通知', steps: ['补充学生证与成绩单', '提交项目申报'], evidence: [{ evidence_id: 'ev-extension-deadline', type: 'deadline', label: '新截止时间', source_text: '现延期至9月18日23:59' }, { evidence_id: 'ev-extension-materials', type: 'materials', label: '新增材料', source_text: '新增材料：学生证和成绩单' }] }],
  },
};

function initialState() {
  return { tasks: [{ task_id: 'task-student', title: '完成学籍信息核验', status: 'pending', due_at: '2026-09-15T23:59:00+08:00', due_display: '今天 23:59', platform: '学信网', source: '教务处', action_id: 'action-student' }, { task_id: 'task-orientation', title: '完成实验室安全准入学习', status: 'pending', due_at: '2026-09-15T18:00:00+08:00', due_display: '今天 18:00', platform: '学习平台', source: '实验室管理处', action_id: 'action-orientation' }, { task_id: 'task-scholarship', title: '国家奖学金材料提交', status: 'pending', due_at: '2026-09-18T17:00:00+08:00', due_display: '3 天后 · 17:00', platform: '学院初审', source: '学生资助管理中心', action_id: 'action-scholarship' }, { task_id: 'task-extension', title: '大学生创新训练项目申报', status: 'changed', due_at: '2026-09-15T23:59:00+08:00', due_display: '原定 9 月 15 日 23:59', platform: '创新训练项目系统', source: '教务处', action_id: 'action-extension' }], jobs: {}, documents: {}, pollCount: {}, scenario: 'student' };
}

function readState() { return wx.getStorageSync(STORAGE_KEY) || initialState(); }
function writeState(state) { wx.setStorageSync(STORAGE_KEY, state); return state; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function findAction(actionId) { for (const item of Object.values(scenarios)) { const found = item.actions.find((action) => action.action_id === actionId); if (found) return clone(found); } return null; }
function pickScenario(text) { if (/奖学金/.test(text)) return 'scholarship'; if (/延期|延长|创新训练/.test(text)) return 'extension'; return 'student'; }

module.exports = {
  reset() { writeState(initialState()); },
  getDemoScenario(name) { const scenario = scenarios[name] || scenarios.student; return Promise.resolve(clone(scenario)); },
  getTasks() { return Promise.resolve({ tasks: clone(readState().tasks) }); },
  createDocument(text) { const state = readState(); const id = `doc-${Date.now()}`; state.documents[id] = { document_id: id, text }; state.scenario = pickScenario(text); writeState(state); return Promise.resolve({ document: clone(state.documents[id]) }); },
  uploadMediaDocument() { return this.createDocument(scenarios.student.source); },
  parseDocument(documentId) { const state = readState(); const jobId = `job-${Date.now()}`; state.jobs[jobId] = { parse_job_id: jobId, document_id: documentId, status: 'queued', result: null }; state.pollCount[jobId] = 0; writeState(state); return Promise.resolve(clone(state.jobs[jobId])); },
  getParseJob(jobId) { const state = readState(); const job = state.jobs[jobId]; if (!job) return Promise.reject(new Error('job not found')); state.pollCount[jobId] += 1; if (state.pollCount[jobId] >= 2) { const scenario = scenarios[state.scenario] || scenarios.student; job.status = 'succeeded'; job.result = { document_assessment: clone(scenario.assessment), verified_actions: clone(scenario.actions), source_text: scenario.source, scenario: state.scenario }; } writeState(state); return Promise.resolve(clone(job)); },
  confirmAction(actionId) { return Promise.resolve({ action: { action_id: actionId, verification_status: 'confirmed' } }); },
  rejectAction() { return Promise.resolve({ ok: true }); },
  createTask(actionId) { const state = readState(); const action = findAction(actionId); if (!action) return Promise.reject(new Error('action not found')); let task = state.tasks.find((item) => item.action_id === actionId); if (!task) { task = { task_id: `task-${Date.now()}`, title: action.title, status: 'pending', due_at: action.deadline.value, due_display: action.deadline.display, platform: action.platform, source: action.source, action_id: action.action_id }; state.tasks.unshift(task); } writeState(state); return Promise.resolve({ task: clone(task) }); },
  createManualTask(documentId, title, dueAt) { const state = readState(); const task = { task_id: `task-${Date.now()}`, title, status: 'pending', due_at: dueAt || '', due_display: dueAt || '待确认', platform: '待确认', source: state.documents[documentId] ? '导入通知' : '手动创建', action_id: '' }; state.tasks.unshift(task); writeState(state); return Promise.resolve({ task: clone(task) }); },
  getAction(actionId) { return Promise.resolve({ action: findAction(actionId) || findAction('action-student') }); },
  getEvidence(actionId) { const action = findAction(actionId) || findAction('action-student'); const scenario = Object.values(scenarios).find((item) => item.actions.some((entry) => entry.action_id === action.action_id)) || scenarios.student; return Promise.resolve({ action: clone(action), source_text: scenario.source }); },
  getTask(taskId) { const task = readState().tasks.find((item) => item.task_id === taskId); return task ? Promise.resolve({ task: clone(task), action: findAction(task.action_id) }) : Promise.reject(new Error('task not found')); },
  completeTask(taskId) { const state = readState(); const task = state.tasks.find((item) => item.task_id === taskId); if (!task) return Promise.reject(new Error('task not found')); task.status = 'completed'; writeState(state); return Promise.resolve({ task: clone(task) }); },
  getNotificationDiff() { return Promise.resolve({ notification_id: 'notice-extension', title: '关于延长大学生创新训练项目申报时间的补充通知', source: scenarios.extension.source, fields: [{ label: '截止时间', oldValue: '9 月 15 日 23:59', newValue: '9 月 18 日 23:59', type: 'deadline' }, { label: '材料', oldValue: '学生证', newValue: '学生证 + 成绩单', type: 'materials' }] }); },
  applyNotificationDiff() { const state = readState(); const task = state.tasks.find((item) => item.task_id === 'task-extension'); if (task) { task.status = 'pending'; task.due_at = '2026-09-18T23:59:00+08:00'; task.due_display = '9 月 18 日 23:59'; } writeState(state); return Promise.resolve({ ok: true }); },
  getProfile() { return Promise.resolve({ profile: { school: '示例大学', grade: '2026届', education_level: '本科', college: '计算机学院', identity: '在校学生' } }); },
  updateProfile(data) { return Promise.resolve({ profile: data }); },
  exportUserData() { return Promise.resolve(readState()); },
};
