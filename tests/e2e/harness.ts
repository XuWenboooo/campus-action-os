export type E2EStepStatus = 'pending_adapter' | 'complete';

export type E2EStep = {
  name: string;
  status: E2EStepStatus;
  owner: 'product' | 'ai' | 'integration' | 'user';
  note: string;
};

export type M2TextE2ERun = {
  development_only: true;
  synthetic: true;
  not_model_output: true;
  scenario: string;
  steps: E2EStep[];
  task_created: false;
};

const stepDefinitions: Array<Pick<E2EStep, 'name' | 'owner' | 'note'>> = [
  { name: 'submit text', owner: 'product', note: 'pending product API adapter' },
  { name: 'call AI text parser', owner: 'product', note: 'pending product-to-parser adapter' },
  { name: 'return protocol object', owner: 'ai', note: 'pending AI service adapter' },
  {
    name: 'validate parser response',
    owner: 'integration',
    note: 'shared protocol validator is ready',
  },
  { name: 'show result to user', owner: 'product', note: 'pending product UI adapter' },
  { name: 'confirm action', owner: 'user', note: 'must be explicit before task creation' },
  {
    name: 'save task',
    owner: 'product',
    note: 'pending product persistence adapter; forbidden before confirmation',
  },
];

export function createPendingM2TextE2ERun(scenario: string): M2TextE2ERun {
  return {
    development_only: true,
    synthetic: true,
    not_model_output: true,
    scenario,
    steps: stepDefinitions.map((step) => ({ ...step, status: 'pending_adapter' })),
    task_created: false,
  };
}

export function assertUserConfirmationBeforeTask(run: M2TextE2ERun): void {
  const confirmationIndex = run.steps.findIndex((step) => step.name === 'confirm action');
  const saveIndex = run.steps.findIndex((step) => step.name === 'save task');
  if (confirmationIndex < 0 || saveIndex < 0 || confirmationIndex > saveIndex || run.task_created) {
    throw new Error('task creation requires explicit user confirmation');
  }
}
