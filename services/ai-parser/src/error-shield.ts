import type { VerifiedActionObject } from '@campus-action-os/protocol';

export type CriticalError = {
  code:
    | 'MISSING_EVIDENCE'
    | 'DEADLINE_UNSAFE'
    | 'UNSUPPORTED_CLAIM'
    | 'CONFLICTING_STATE'
    | 'DANGLING_REFERENCE'
    | 'ACTION_NOT_CONFIRMABLE'
    | 'TASK_SIDE_EFFECT_BLOCKED';
  field: string;
  message: string;
};

const evidenceForField: Record<string, string[]> = {
  user_relevance: ['user_relevance', 'target_population'],
  target_population: ['target_population'],
  steps: ['steps'],
  deadline: ['deadline'],
  required_materials: ['required_materials'],
  location: ['location'],
  platform: ['platform'],
  conditions: ['conditions'],
  exceptions: ['exceptions'],
};

export function inspectCriticalErrors(action: VerifiedActionObject): CriticalError[] {
  const errors: CriticalError[] = [];
  const evidenceFields = new Set<string>(action.evidence.map((item) => item.field_name));
  for (const [field, status] of Object.entries(action.field_status)) {
    if (
      status === 'explicit' &&
      !(evidenceForField[field] ?? [field]).some((name) => evidenceFields.has(name))
    ) {
      errors.push({
        code: 'MISSING_EVIDENCE',
        field,
        message: `显式字段 ${field} 缺少字段级原文证据`,
      });
    }
  }
  if (action.deadline.value === null || action.deadline.precision === 'unknown') {
    errors.push({
      code: 'DEADLINE_UNSAFE',
      field: 'deadline',
      message: '截止时间未知，禁止自动创建可执行任务',
    });
  }
  if (
    action.verification_status === 'conflict' &&
    ['in_progress', 'completed'].includes(action.task_status)
  )
    errors.push({
      code: 'CONFLICTING_STATE',
      field: 'task_status',
      message: '冲突行动不能保持进行中或已完成的任务状态',
    });
  if (action.deadline.value !== null && action.deadline.evidence_ids.length === 0) {
    errors.push({
      code: 'UNSUPPORTED_CLAIM',
      field: 'deadline',
      message: '确定的截止时间没有证据引用',
    });
  }
  const evidenceIds = new Set(action.evidence.map((item) => item.evidence_id));
  const referencedIds = [
    ...action.deadline.evidence_ids,
    ...action.steps.flatMap((step) => [
      ...step.evidence_ids,
      ...(step.location?.evidence_ids ?? []),
      ...(step.platform?.evidence_ids ?? []),
      ...(step.required_materials ?? []).flatMap((material) => material.evidence_ids),
    ]),
    ...action.required_materials.flatMap((material) => material.evidence_ids),
    ...(action.location?.evidence_ids ?? []),
    ...(action.platform?.evidence_ids ?? []),
    ...(action.entry_link?.evidence_ids ?? []),
    ...(action.consequence?.evidence_ids ?? []),
    ...action.conditions.flatMap((condition) => condition.evidence_ids),
    ...action.exceptions.flatMap((exception) => exception.evidence_ids),
  ];
  const stepIds = new Set(action.steps.map((step) => step.step_id));
  const conditionIds = new Set(action.conditions.map((condition) => condition.condition_id));
  const invalidDependency = action.dependencies.some(
    (dependency) =>
      !stepIds.has(dependency.from_step_id) ||
      !stepIds.has(dependency.to_step_id) ||
      (dependency.condition_id !== undefined && !conditionIds.has(dependency.condition_id)),
  );
  const invalidOutcome = action.conditions.some((condition) =>
    condition.outcomes.some((outcome) => outcome.step_ids.some((stepId) => !stepIds.has(stepId))),
  );
  if (referencedIds.some((id) => !evidenceIds.has(id)) || invalidDependency || invalidOutcome) {
    errors.push({
      code: invalidDependency || invalidOutcome ? 'DANGLING_REFERENCE' : 'UNSUPPORTED_CLAIM',
      field: invalidDependency || invalidOutcome ? 'dependencies' : 'evidence_ids',
      message:
        invalidDependency || invalidOutcome
          ? '行动包含悬空步骤、条件或依赖引用'
          : '行动引用了不存在的证据 ID',
    });
  }
  if (action.task_status !== 'pending' && action.result_stage !== 'user_confirmed') {
    errors.push({
      code: 'TASK_SIDE_EFFECT_BLOCKED',
      field: 'task_status',
      message: '未经用户确认不得改变任务副作用状态',
    });
  }
  if (action.verification_status === 'passed' && action.user_relevance === 'uncertain') {
    errors.push({
      code: 'ACTION_NOT_CONFIRMABLE',
      field: 'user_relevance',
      message: '相关性不确定时不能标记为通过',
    });
  }
  return errors;
}

export function hasCriticalErrors(action: VerifiedActionObject): boolean {
  return inspectCriticalErrors(action).length > 0;
}
