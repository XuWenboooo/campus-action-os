import { createHash } from 'node:crypto';
import {
  validateTextParseResponseAgainstText,
  type TextParseRequest,
  type TextParseResponse,
} from '@campus-action-os/protocol';
import { parseText } from '../../ai-parser/src/rule-parser.js';
import type { SpokenRevisionEvent } from '../../audio-intelligence/src/types.js';

function resolveDeadline(
  action: TextParseResponse['verified_actions'][number],
  revision: SpokenRevisionEvent,
  request: TextParseRequest,
): TextParseResponse['verified_actions'][number]['deadline'] | null {
  if (!revision.new_fact) return null;
  const derivedText = `${action.title}\n截止：${revision.new_fact}`;
  const derived = parseText({
    ...request,
    request_id: `${request.request_id}:revision-deadline`,
    idempotency_key: `${request.idempotency_key}:revision-deadline`,
    document: {
      ...request.document,
      text: derivedText,
      content_sha256: createHash('sha256').update(derivedText, 'utf8').digest('hex'),
    },
  });
  if ('code' in derived || derived.verified_actions.length === 0) return null;
  const deadline = derived.verified_actions[0]?.deadline;
  return deadline?.value ? deadline : null;
}

export function propagateSpokenRevisionDeadlines(
  response: TextParseResponse,
  sourceText: string,
  request: TextParseRequest,
  revisions: readonly SpokenRevisionEvent[],
): TextParseResponse {
  let actions = response.verified_actions;
  let revisedCount = 0;
  for (const revision of revisions) {
    const next = actions.map((action) => {
      const deadline = resolveDeadline(action, revision, request);
      if (!deadline) return action;
      revisedCount += 1;
      const evidenceId = `${action.action_id}:evidence:deadline:${revision.revision_id}`;
      const revisionEvidence = {
        evidence_id: evidenceId,
        source_text: revision.trigger_text || sourceText,
        page_or_image: 'text:1' as const,
        field_name: 'deadline' as const,
        epistemic_status: 'explicit' as const,
      };
      return {
        ...action,
        deadline: { ...deadline, evidence_ids: [evidenceId] },
        evidence: [...action.evidence, revisionEvidence],
        field_status: { ...action.field_status, deadline: 'explicit' as const },
        change_history: [
          ...action.change_history,
          {
            change_id: `${revision.revision_id}:${action.action_id}`,
            occurred_at: new Date().toISOString(),
            actor: 'system' as const,
            change_type: 'corrected' as const,
            reason: 'Propagated spoken deadline revision to the related action',
          },
        ],
      };
    });
    actions = next;
  }
  const candidate: TextParseResponse = {
    ...response,
    verified_actions: actions,
    ...(revisedCount === response.verified_actions.length &&
    actions.every((action) => action.deadline.precision === 'hour' || action.deadline.precision === 'minute')
      ? { warnings: response.warnings.filter((warning) => warning.code !== 'DEADLINE_AMBIGUOUS' && warning.code !== 'DEADLINE_UNKNOWN') }
      : {}),
  };
  const valid = validateTextParseResponseAgainstText(candidate, sourceText);
  if (!valid.ok) throw new Error('Spoken deadline propagation failed evidence alignment');
  return valid.value;
}

