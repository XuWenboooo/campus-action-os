const STORAGE_KEY = 'campusActionMockState';
const STATE_VERSION = 4;
const RELATION_TYPES = ['depends_on', 'blocks', 'same_event', 'conflicts_with', 'revises'];

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
  orchestration: {
    label: '行动编排',
    source: '通知 A：国家奖学金申请截止 9 月 18 日。\n通知 B：国家奖学金申请需要提交成绩单。\n通知 C：成绩单处理预计需要 2 个工作日。\n学院通知：奖学金申请截止 9 月 16 日。\n教务处通知：奖学金申请截止 9 月 18 日。',
    assessment: { user_relevance: 'relevant', relevance_reason: '三条通知共同描述了你的奖学金申请行动链。', confidence: 'high' },
    notices: [
      { notification_id: 'notice-scholarship-deadline', title: '国家奖学金申请截止通知', source: '学生资助管理中心', source_text: '国家奖学金申请截止 9 月 18 日。' },
      { notification_id: 'notice-scholarship-transcript', title: '国家奖学金材料要求通知', source: '学生资助管理中心', source_text: '国家奖学金申请需要提交成绩单。' },
      { notification_id: 'notice-transcript-processing', title: '成绩单办理说明', source: '教务处', source_text: '成绩单处理预计需要 2 个工作日。' },
      { notification_id: 'notice-college-deadline', title: '学院奖学金通知', source: '计算机学院', source_text: '奖学金申请截止 9 月 16 日。' },
      { notification_id: 'notice-academic-deadline', title: '教务处奖学金通知', source: '教务处', source_text: '奖学金申请截止 9 月 18 日。' },
    ],
    actions: [
      { action_id: 'action-transcript', title: '申请成绩单', deadline: { value: '2026-09-16T18:00:00+08:00', display: '9 月 16 日 18:00' }, platform: '教务系统', materials: '成绩单申请信息', audience: '奖学金申请人', condition: '提交奖学金需要成绩单', source: '教务处', steps: ['登录教务系统', '提交成绩单申请'], evidence: [{ evidence_id: 'ev-transcript-need', type: 'materials', label: '奖学金材料', source_text: '国家奖学金申请需要提交成绩单。' }, { evidence_id: 'ev-transcript-time', type: 'deadline', label: '处理时长', source_text: '成绩单处理预计需要 2 个工作日。' }] },
      { action_id: 'action-scholarship-materials', title: '准备其他奖学金材料', deadline: { value: '2026-09-17T18:00:00+08:00', display: '9 月 17 日 18:00' }, platform: '学院初审', materials: '申请表、获奖证书', audience: '奖学金申请人', condition: '与成绩单一起提交完整材料', source: '学生资助管理中心', steps: ['填写申请表', '整理获奖证书'], evidence: [{ evidence_id: 'ev-materials-list', type: 'materials', label: '其他材料', source_text: '申请需要提交申请表、成绩单和获奖证书。' }, { evidence_id: 'ev-materials-deadline', type: 'deadline', label: '最终截止', source_text: '国家奖学金申请截止 9 月 18 日。' }] },
      { action_id: 'action-scholarship-submit', title: '提交奖学金申请', deadline: { value: '2026-09-18T17:00:00+08:00', display: '9 月 18 日 17:00' }, platform: '学院初审 / 奖助系统', materials: '完整奖学金申请材料', audience: '奖学金申请人', condition: '前置材料准备完成后提交', source: '学生资助管理中心', steps: ['提交学院初审', '审核通过后完成线上确认'], evidence: [{ evidence_id: 'ev-submit-deadline', type: 'deadline', label: '申请截止', source_text: '国家奖学金申请截止 9 月 18 日。' }, { evidence_id: 'ev-submit-materials', type: 'materials', label: '提交要求', source_text: '申请需要提交申请表、成绩单和获奖证书。' }] },
      { action_id: 'action-conflict', title: '奖学金截止日期核对', deadline: { value: null, display: '待确认' }, platform: '学院通知 / 教务处通知', materials: '两份截止时间通知', audience: '奖学金申请人', condition: '两个来源给出了不同截止日期', source: '学院与教务处通知', steps: ['对照两份通知', '确认采用的截止日期'], evidence: [{ evidence_id: 'ev-conflict-college', type: 'deadline', label: '学院版本', source_text: '学院通知：奖学金申请截止 9 月 16 日。' }, { evidence_id: 'ev-conflict-academic', type: 'deadline', label: '教务处版本', source_text: '教务处通知：奖学金申请截止 9 月 18 日。' }] },
    ],
    relations: [
      { relation_id: 'rel-transcript-materials', type: 'depends_on', from_action_id: 'action-scholarship-materials', to_action_id: 'action-transcript', confidence: 'high', evidence: [{ evidence_id: 'ev-rel-transcript-materials', label: '前置材料依据', source_text: '国家奖学金申请需要提交成绩单。' }], source_notifications: ['notice-scholarship-transcript', 'notice-transcript-processing'] },
      { relation_id: 'rel-materials-submit', type: 'depends_on', from_action_id: 'action-scholarship-submit', to_action_id: 'action-scholarship-materials', confidence: 'high', evidence: [{ evidence_id: 'ev-rel-materials-submit', label: '提交条件依据', source_text: '申请需要提交申请表、成绩单和获奖证书。' }], source_notifications: ['notice-scholarship-deadline', 'notice-scholarship-transcript'] },
      { relation_id: 'rel-same-event', type: 'same_event', from_action_id: 'action-transcript', to_action_id: 'action-scholarship-submit', confidence: 'medium', evidence: [{ evidence_id: 'ev-rel-same-event', label: '同一事项', source_text: '三条通知共同描述国家奖学金申请。' }], source_notifications: ['notice-scholarship-deadline', 'notice-scholarship-transcript', 'notice-transcript-processing'] },
      { relation_id: 'rel-conflict-submit', type: 'conflicts_with', from_action_id: 'action-scholarship-submit', to_action_id: 'action-conflict', confidence: 'high', evidence: [{ evidence_id: 'ev-rel-conflict-submit', label: '冲突依据', source_text: '学院通知与教务处通知给出了不同截止日期。' }], source_notifications: ['notice-college-deadline', 'notice-academic-deadline'] },
    ],
    priority_suggestion: { title: '建议今天优先申请成绩单', reason: '提交奖学金需要成绩单，而成绩单预计需要 2 个工作日，最终申请截止为 9 月 18 日。', action_id: 'action-transcript', evidence_ids: ['ev-transcript-need', 'ev-transcript-time', 'ev-submit-deadline'], source_notifications: ['notice-scholarship-deadline', 'notice-scholarship-transcript', 'notice-transcript-processing'], factors: [{ label: '截止临近', value: '9 月 18 日', evidence_ids: ['ev-submit-deadline'] }, { label: '前置依赖', value: '提交奖学金需要成绩单', evidence_ids: ['ev-transcript-need'] }, { label: '处理时长', value: '预计 2 个工作日', evidence_ids: ['ev-transcript-time'] }] },
    conflicts: [{ conflict_id: 'conflict-scholarship-deadline', field: 'deadline', valueA: '09-16', valueB: '09-18', evidenceA: ['ev-conflict-college'], evidenceB: ['ev-conflict-academic'], status: 'unresolved', title: '奖学金截止日期存在两个版本', reason: '学院通知与教务处通知给出了不同截止日期，系统不会自动覆盖任何任务。' }],
    change_impacts: [{ impact_id: 'impact-scholarship-deadline', change_event_id: 'conflict-scholarship-deadline', affected_actions: ['action-scholarship-submit', 'action-scholarship-materials'], downstream_actions: ['action-scholarship-submit'], evidence_ids: ['ev-conflict-college', 'ev-conflict-academic'], status: 'blocked_by_unresolved_conflict' }],
  },
};

function baselineState() {
  return { schemaVersion: STATE_VERSION, mode: 'BASELINE', activeScenario: null, tasks: [{ task_id: 'task-orientation', title: '完成实验室安全准入学习', status: 'pending', due_at: '2026-09-15T18:00:00+08:00', due_display: '今天 18:00', home_bucket: 'today', platform: '学习平台', source: '实验室管理处', action_id: 'action-orientation' }], changeEvents: [], jobs: {}, documents: {}, pollCount: {} };
}

function readState() {
  const stored = wx.getStorageSync(STORAGE_KEY);
  if (!stored || stored.schemaVersion !== STATE_VERSION) return writeState(baselineState());
  return stored;
}
function writeState(state) { wx.setStorageSync(STORAGE_KEY, state); return state; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function uniqueId(prefix) { return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function findAction(actionId) { for (const item of Object.values(scenarios)) { const found = item.actions.find((action) => action.action_id === actionId); if (found) return clone(found); } return null; }
function pickScenario(text) { if (/成绩单|2个工作日|行动编排/.test(text)) return 'orchestration'; if (/延期|延长|创新训练/.test(text)) return 'extension'; if (/奖学金/.test(text)) return 'scholarship'; return 'student'; }

module.exports = {
  resetDemoState() { return Promise.resolve(clone(writeState(baselineState()))); },
  enterDemoScenario(name) {
    const scenario = ['student', 'scholarship', 'extension', 'orchestration'].includes(name) ? name : 'student';
    const state = baselineState();
    state.mode = `DEMO_${scenario.toUpperCase()}`;
    state.activeScenario = scenario;
    if (scenario === 'extension') {
      state.tasks.push({ task_id: 'task-extension', title: '大学生创新训练项目申报', status: 'pending', due_at: '2026-09-15T23:59:00+08:00', due_display: '9 月 15 日 23:59', home_bucket: 'today', platform: '创新训练项目系统', source: '教务处', action_id: 'action-extension' });
      state.changeEvents.push({ change_event_id: 'change-extension', status: 'pending', task_id: 'task-extension', notification_id: 'notice-extension', title: '大学生创新训练项目申报', change_label: '截止时间发生变化', old_value: '09-15 23:59', new_value: '09-18 23:59', source: '教务处 · 补充通知', reason: '补充通知将原截止时间延期至 9 月 18 日 23:59。', impact: { affected_action_ids: ['action-extension'], downstream_action_ids: [], evidence_ids: ['ev-extension-deadline', 'ev-extension-materials'], status: 'pending' } });
    }
    return Promise.resolve(clone(writeState(state)));
  },
  getDemoState() { return Promise.resolve(clone(readState())); },
  getDemoScenario(name) { const scenario = scenarios[name] || scenarios.student; return Promise.resolve(clone(scenario)); },
  getTasks() { return Promise.resolve({ tasks: clone(readState().tasks) }); },
  getPendingChanges() { const state = readState(); const changes = state.changeEvents.filter((event) => event.status === 'pending').map((event) => { const task = state.tasks.find((item) => item.task_id === event.task_id) || null; return { ...clone(event), task_id: event.task_id, task_title: task ? task.title : event.title }; }); return Promise.resolve({ changes }); },
  getOrchestrationSummary() { const state = readState(); const scenario = state.activeScenario === 'orchestration' ? scenarios.orchestration : null; return Promise.resolve({ suggestion: scenario ? clone(scenario.priority_suggestion) : null, conflict: scenario ? clone(scenario.conflicts.find((item) => item.status === 'unresolved') || null) : null, relations: scenario ? clone(scenario.relations) : [], relation_types: clone(RELATION_TYPES), change_impacts: scenario ? clone(scenario.change_impacts) : [] }); },
  getOrchestrationResult() { const scenario = scenarios.orchestration; return Promise.resolve({ document_assessment: clone(scenario.assessment), verified_actions: clone(scenario.actions.slice(0, 3)), orchestration_actions: clone(scenario.actions.slice(0, 3)), source_text: scenario.source, scenario: 'orchestration', orchestration: true, relations: clone(scenario.relations), relation_types: clone(RELATION_TYPES), priority_suggestion: clone(scenario.priority_suggestion), conflicts: clone(scenario.conflicts), change_impacts: clone(scenario.change_impacts) }); },
  createDocument(text) { const state = readState(); const id = uniqueId('doc'); const scenario = pickScenario(text); state.documents[id] = { document_id: id, text, scenario }; writeState(state); return Promise.resolve({ document: clone(state.documents[id]) }); },
  uploadMediaDocument() { return this.createDocument(scenarios.student.source); },
  parseDocument(documentId) { const state = readState(); const jobId = uniqueId('job'); state.jobs[jobId] = { parse_job_id: jobId, document_id: documentId, status: 'queued', result: null }; state.pollCount[jobId] = 0; writeState(state); return Promise.resolve(clone(state.jobs[jobId])); },
  getParseJob(jobId) { const state = readState(); const job = state.jobs[jobId]; if (!job) return Promise.reject(new Error('job not found')); state.pollCount[jobId] += 1; if (state.pollCount[jobId] >= 2) { const document = state.documents[job.document_id] || {}; const scenarioName = document.scenario || 'student'; const scenario = scenarios[scenarioName] || scenarios.student; const actions = scenarioName === 'orchestration' ? scenario.actions.slice(0, 3) : scenario.actions; job.status = 'succeeded'; job.result = { document_assessment: clone(scenario.assessment), verified_actions: clone(actions), orchestration_actions: clone(actions), source_text: scenario.source, scenario: scenarioName, orchestration: scenarioName === 'orchestration', relations: clone(scenario.relations || []), relation_types: clone(RELATION_TYPES), priority_suggestion: clone(scenario.priority_suggestion || null), conflicts: clone(scenario.conflicts || []), change_impacts: clone(scenario.change_impacts || []) }; } writeState(state); return Promise.resolve(clone(job)); },
  confirmAction(actionId) { return Promise.resolve({ action: { action_id: actionId, verification_status: 'confirmed' } }); },
  rejectAction() { return Promise.resolve({ ok: true }); },
  createTask(actionId) { const state = readState(); const action = findAction(actionId); if (!action) return Promise.reject(new Error('action not found')); let task = state.tasks.find((item) => item.action_id === actionId); if (!task) { task = { task_id: uniqueId('task'), title: action.title, status: 'pending', due_at: action.deadline.value, due_display: action.deadline.display, home_bucket: action.action_id === 'action-scholarship' ? 'upcoming' : 'today', platform: action.platform, source: action.source, action_id: action.action_id }; state.tasks.unshift(task); } writeState(state); return Promise.resolve({ task: clone(task) }); },
  createManualTask(documentId, title, dueAt) { const state = readState(); const task = { task_id: uniqueId('task'), title, status: 'pending', due_at: dueAt || '', due_display: dueAt || '待确认', home_bucket: dueAt && /^2026-09-15/.test(dueAt) ? 'today' : 'upcoming', platform: '待确认', source: state.documents[documentId] ? '导入通知' : '手动创建', action_id: '' }; state.tasks.unshift(task); writeState(state); return Promise.resolve({ task: clone(task) }); },
  getAction(actionId) { return Promise.resolve({ action: findAction(actionId) || findAction('action-student') }); },
  getEvidence(actionId) { const action = findAction(actionId) || findAction('action-student'); const scenario = Object.values(scenarios).find((item) => item.actions.some((entry) => entry.action_id === action.action_id)) || scenarios.student; return Promise.resolve({ action: clone(action), source_text: scenario.source }); },
  getTask(taskId) { const task = readState().tasks.find((item) => item.task_id === taskId); return task ? Promise.resolve({ task: clone(task), action: findAction(task.action_id) }) : Promise.reject(new Error('task not found')); },
  completeTask(taskId) { const state = readState(); const task = state.tasks.find((item) => item.task_id === taskId); if (!task) return Promise.reject(new Error('task not found')); task.status = 'completed'; writeState(state); return Promise.resolve({ task: clone(task) }); },
  getNotificationDiff(changeEventId) { const state = readState(); const event = state.changeEvents.find((item) => item.change_event_id === changeEventId) || state.changeEvents.find((item) => item.status === 'pending'); if (!event) return Promise.reject(new Error('change event not found')); return Promise.resolve({ ...clone(event), task_id: event.task_id, notification_id: event.notification_id, title: '关于延长大学生创新训练项目申报时间的补充通知', source: scenarios.extension.source, fields: [{ label: '截止时间', oldValue: '9 月 15 日 23:59', newValue: '9 月 18 日 23:59', type: 'deadline' }, { label: '材料', oldValue: '学生证', newValue: '学生证 + 成绩单', type: 'materials' }], impacts: [{ label: '受影响行动', value: '补充学生证与成绩单、提交项目申报', affected_action_ids: ['action-extension'], evidence: '新增材料：学生证和成绩单', evidence_ids: ['ev-extension-materials'], status: event.impact ? event.impact.status : event.status }, { label: '下游影响', value: '任务由今天自动移入未来 3 天', downstream_action_ids: [], evidence: '现延期至9月18日23:59', evidence_ids: ['ev-extension-deadline'], status: event.impact ? event.impact.status : event.status }] }); },
  applyNotificationDiff(changeEventId) { const state = readState(); const event = state.changeEvents.find((item) => item.change_event_id === changeEventId) || state.changeEvents.find((item) => item.status === 'pending'); if (!event) return Promise.reject(new Error('change event not found')); const task = state.tasks.find((item) => item.task_id === event.task_id); if (task) { task.status = 'pending'; task.home_bucket = 'upcoming'; task.due_at = '2026-09-18T23:59:00+08:00'; task.due_display = '9 月 18 日 23:59'; } event.status = 'resolved'; if (event.impact) event.impact.status = 'resolved'; event.resolved_at = new Date().toISOString(); writeState(state); return Promise.resolve({ ok: true, change_event_id: event.change_event_id, task_id: event.task_id, status: event.status, impact: clone(event.impact || null) }); },
  dismissNotificationDiff(changeEventId) { const state = readState(); const event = state.changeEvents.find((item) => item.change_event_id === changeEventId); if (!event) return Promise.reject(new Error('change event not found')); event.status = 'dismissed'; writeState(state); return Promise.resolve({ ok: true, change_event_id: event.change_event_id, status: event.status }); },
  getProfile() { return Promise.resolve({ profile: { school: '示例大学', grade: '2026届', education_level: '本科', college: '计算机学院', identity: '在校学生' } }); },
  updateProfile(data) { return Promise.resolve({ profile: data }); },
  exportUserData() { return Promise.resolve(readState()); },
};
