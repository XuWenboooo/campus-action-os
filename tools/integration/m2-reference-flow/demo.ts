import { fixtures } from '../../../tests/fixtures/m2-text/catalog.js';
import { M2ReferenceFlow, referenceFlowProvenance } from '../../../tests/e2e/m2-reference-flow.js';

const flow = new M2ReferenceFlow();
const request = fixtures.find((item) => item.id === 'single-action')?.request;
if (!request) throw new Error('single-action fixture is missing');

const parsed = flow.submit(request);
const review = flow.review(request.request_id);
const actionId = review.actions[0]?.action_id;
if (!actionId) throw new Error('demo fixture has no action');

console.log(
  JSON.stringify(
    {
      ...referenceFlowProvenance,
      demo: 'm2-independent-reference-flow',
      steps: [
        { name: 'submit', status: parsed.status, request_id: parsed.request_id },
        {
          name: 'review',
          status: review.status,
          task_count: flow.listTasks().length,
          explicit_confirmation_required: review.explicit_confirmation_required,
        },
        { name: 'confirm', task_count: flow.confirm(request.request_id, [actionId]).length },
      ],
      tasks: flow.listTasks(),
    },
    null,
    2,
  ),
);
