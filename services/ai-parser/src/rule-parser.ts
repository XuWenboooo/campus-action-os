import { createHash, randomUUID } from 'node:crypto';
import {
  validateTextParseRequest,
  validateTextParseResponse,
  type ActionGraph,
  type ActionStep,
  type Claim,
  type Evidence,
  type TextParseRequest,
  type TextParseResponse,
  type VerifiedActionObject,
} from '@campus-action-os/protocol';
import { inspectCriticalErrors } from './error-shield.js';

export type ParserFailure = {
  code: 'INVALID_REQUEST' | 'UNSUPPORTED_CONTENT_TYPE';
  message: string;
};

function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function lineFor(text: string, pattern: RegExp): string | undefined {
  return text.split('\n').find((line) => pattern.test(line.trim()));
}

function claim(
  value: string | null,
  epistemicStatus: Claim['epistemic_status'],
  evidenceIds: string[],
): Claim {
  return { value, epistemic_status: epistemicStatus, evidence_ids: evidenceIds };
}

function isoDeadline(line: string | undefined): {
  value: string | null;
  precision: VerifiedActionObject['deadline']['precision'];
  boundary: VerifiedActionObject['deadline']['boundary_semantics'];
  ambiguous: boolean;
} {
  if (!line || /尽快|另行通知|待确认|工作日/.test(line)) {
    return { value: null, precision: 'unknown', boundary: 'unknown', ambiguous: Boolean(line) };
  }
  const match = line.match(
    /(20\d{2})[-年](\d{1,2})[-月](\d{1,2})日?(?:[ T](\d{1,2})[:：](\d{2}))?/,
  );
  if (!match) return { value: null, precision: 'unknown', boundary: 'unknown', ambiguous: false };
  const [, year, month, day, hour, minute] = match;
  const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const value = hour === undefined ? date : `${date}T${hour.padStart(2, '0')}:${minute}:00+08:00`;
  const boundary = /截至|不晚于/.test(line)
    ? 'no_later_than'
    : /之后|以后/.test(line)
      ? 'after'
      : /当天|当日/.test(line)
        ? 'on'
        : 'before';
  return {
    value,
    precision: hour === undefined ? 'day' : 'minute',
    boundary,
    ambiguous: /前|之前/.test(line) && hour === undefined,
  };
}

function findActions(lines: string[]): Array<{ text: string; line: string }> {
  const numbered = lines
    .map((line) => ({ line, match: line.trim().match(/^(?:\d+[.)、]|[-*])\s*(.+)$/) }))
    .filter((item): item is { line: string; match: RegExpMatchArray } => Boolean(item.match))
    .map(({ line, match }) => ({ text: match[1].trim(), line }));
  if (numbered.length > 0) return numbered;
  return lines
    .filter(
      (line) =>
        /请|需|完成|提交|报名|参加|上传|填写|预约/.test(line) &&
        !/适用|截止|材料|地点|平台|条件/.test(line),
    )
    .slice(0, 8)
    .map((line) => ({ text: line.trim(), line }));
}

function evidence(id: string, sourceText: string, fieldName: Evidence['field_name']): Evidence {
  return {
    evidence_id: id,
    source_text: sourceText,
    page_or_image: 'text:1',
    field_name: fieldName,
    epistemic_status: 'explicit',
  };
}

export function parseText(request: TextParseRequest): TextParseResponse | ParserFailure {
  const validRequest = validateTextParseRequest(request);
  if (!validRequest.ok)
    return { code: 'INVALID_REQUEST', message: '请求不符合 text-parse-request/v1' };
  if (request.document.content_type !== 'text/plain')
    return { code: 'UNSUPPORTED_CONTENT_TYPE', message: 'rule parser 目前只接受标准化 text/plain' };
  const startedAt = new Date().toISOString();
  const source = normalize(request.document.text);
  const lines = source
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const title = (lines[0] ?? '未命名校园通知').replace(/^【|】$/g, '').slice(0, 300);
  const audienceLine = lineFor(source, /适用对象|面向|仅限|本科生|研究生|全体学生/);
  const audience =
    audienceLine?.replace(/^(适用对象|面向)[:：]?\s*/, '').trim() || '未明确适用对象';
  const profileText = Object.values(request.user_profile).flat().join(' ');
  const hasExclusion = /不包括|除.*外|不适用于|仅限/.test(source);
  const knownAudience = /全体学生|本科生|研究生|大一学生|毕业生|应届毕业生|住宿学生/.test(audience);
  const audienceMatches =
    /全体|所有|学生|本科生|研究生/.test(audience) &&
    (profileText.length === 0 || /本科|undergraduate|student|学生/.test(profileText));
  const userRelevance =
    audience === '未明确适用对象'
      ? 'uncertain'
      : audienceMatches
        ? 'relevant'
        : hasExclusion || !knownAudience
          ? 'uncertain'
          : 'irrelevant';
  const relevanceEvidence = audienceLine
    ? evidence('ev-relevance', audienceLine, 'user_relevance')
    : undefined;
  const actionInputs = findActions(lines);
  const deadlineLine = lineFor(source, /截止|截至|前完成|报名时间|20\d{2}[-年]/);
  const materialsLine = lineFor(source, /材料|携带|提交.*(证件|证明|附件)/);
  const locationLine = lineFor(source, /地点|地址|教室|现场/);
  const platformLine = lineFor(source, /平台|系统|线上|邮箱|链接|网址/);
  const conditionLine = lineFor(source, /条件|要求|仅限|须知|须满足|如果|若/);
  const exceptionLine = lineFor(source, /除.*外|不适用于|例外/);
  const deadline = isoDeadline(deadlineLine);
  const warnings: TextParseResponse['warnings'] = [];
  if (!deadline.value)
    warnings.push({
      code: 'DEADLINE_UNKNOWN',
      message: '截止时间缺失或无法安全解析，需要用户确认',
      paths: ['/verified_actions/*/deadline'],
    });
  if (deadline.ambiguous)
    warnings.push({
      code: 'DEADLINE_AMBIGUOUS',
      message: '日期精度或边界语义存在歧义，需要用户确认',
      paths: ['/verified_actions/*/deadline'],
    });
  if (userRelevance === 'uncertain')
    warnings.push({
      code: 'RELEVANCE_UNCERTAIN',
      message: '无法仅凭通知和用户画像确定相关性',
      paths: ['/document_assessment/user_relevance'],
    });
  if (actionInputs.length === 0)
    warnings.push({
      code: 'ACTION_MISSING',
      message: '未找到明确可执行行动',
      paths: ['/verified_actions'],
    });
  const parsedActions = actionInputs.map(({ text, line }, index): VerifiedActionObject => {
    const actionId = `${request.document.document_id}:action:${index + 1}`;
    const actionRelevanceEvidence = relevanceEvidence
      ? evidence(`ev-relevance-${index + 1}`, relevanceEvidence.source_text, 'user_relevance')
      : undefined;
    const populationEvidence = audienceLine
      ? evidence(`ev-population-${index + 1}`, audienceLine, 'target_population')
      : undefined;
    const actionEvidence: Evidence[] = [evidence(`ev-step-${index + 1}`, line, 'steps')];
    const step: ActionStep = {
      step_id: `${actionId}:step:1`,
      instruction: text,
      epistemic_status: 'explicit',
      evidence_ids: [`ev-step-${index + 1}`],
    };
    const materials = materialsLine
      ? materialsLine
          .replace(/^.*?(材料|携带|提交)[:：]?\s*/, '')
          .split(/[、,，;；]/)
          .map((description, materialIndex) => ({
            material_id: `${actionId}:material:${materialIndex + 1}`,
            description: description.trim(),
            epistemic_status: 'explicit' as const,
            evidence_ids: [`ev-material-${index + 1}`],
          }))
          .filter((item) => item.description)
      : [];
    if (materialsLine)
      actionEvidence.push(
        evidence(`ev-material-${index + 1}`, materialsLine, 'required_materials'),
      );
    const location = locationLine
      ? claim(locationLine.replace(/^.*?(地点|地址)[:：]?\s*/, ''), 'explicit', [
          `ev-location-${index + 1}`,
        ])
      : null;
    if (locationLine)
      actionEvidence.push(evidence(`ev-location-${index + 1}`, locationLine, 'location'));
    const platform = platformLine
      ? claim(platformLine.replace(/^.*?(平台|系统)[:：]?\s*/, ''), 'explicit', [
          `ev-platform-${index + 1}`,
        ])
      : null;
    if (platformLine)
      actionEvidence.push(evidence(`ev-platform-${index + 1}`, platformLine, 'platform'));
    const link = source.match(/https?:\/\/[^\s)]+/)?.[0] ?? null;
    const entryLink = link ? claim(link, 'explicit', [`ev-entry-${index + 1}`]) : null;
    if (link)
      actionEvidence.push(evidence(`ev-entry-${index + 1}`, platformLine ?? link, 'entry_link'));
    const condition = conditionLine
      ? [
          {
            condition_id: `${actionId}:condition:1`,
            statement: conditionLine,
            outcomes: [
              { label: '满足条件', step_ids: [step.step_id] },
              { label: '不满足条件', step_ids: [] },
            ],
            epistemic_status: 'explicit' as const,
            evidence_ids: [`ev-condition-${index + 1}`],
          },
        ]
      : [];
    if (conditionLine)
      actionEvidence.push(evidence(`ev-condition-${index + 1}`, conditionLine, 'conditions'));
    const exception = exceptionLine
      ? [
          {
            exception_id: `${actionId}:exception:1`,
            statement: exceptionLine,
            epistemic_status: 'explicit' as const,
            evidence_ids: [`ev-exception-${index + 1}`],
          },
        ]
      : [];
    if (exceptionLine)
      actionEvidence.push(evidence(`ev-exception-${index + 1}`, exceptionLine, 'exceptions'));
    if (deadlineLine)
      actionEvidence.push(evidence(`ev-deadline-${index + 1}`, deadlineLine, 'deadline'));
    if (actionRelevanceEvidence) actionEvidence.push(actionRelevanceEvidence);
    if (populationEvidence) actionEvidence.push(populationEvidence);
    const status =
      userRelevance === 'relevant' && warnings.length === 0
        ? 'passed'
        : 'user_confirmation_required';
    const fieldStatus = {
      user_relevance: actionRelevanceEvidence ? 'explicit' : 'unknown',
      target_population: populationEvidence ? 'explicit' : 'unknown',
      steps: 'explicit',
      deadline: deadlineLine && deadline.value ? 'explicit' : 'unknown',
      required_materials: materialsLine ? 'explicit' : 'unknown',
      location: locationLine ? 'explicit' : 'unknown',
      platform: platformLine ? 'explicit' : 'unknown',
      conditions: conditionLine ? 'explicit' : 'unknown',
      exceptions: exceptionLine ? 'explicit' : 'unknown',
    } as const;
    return {
      schema_version: 'verified-action-object/v1',
      action_id: actionId,
      document_id: request.document.document_id,
      title: text.slice(0, 300),
      target_population: [audience],
      user_relevance: userRelevance,
      relevance_reason:
        userRelevance === 'relevant'
          ? '用户画像与通知适用对象匹配'
          : userRelevance === 'irrelevant'
            ? '用户画像未匹配通知适用对象'
            : '通知或用户画像存在无法安全消解的不确定性',
      action_type: 'campus_notice_action',
      steps: [step],
      dependencies: [],
      conditions: condition,
      exceptions: exception,
      deadline: {
        value: deadline.value,
        precision: deadline.precision,
        boundary_semantics: deadline.boundary,
        timezone: 'Asia/Shanghai',
        epistemic_status: deadline.value ? 'explicit' : 'unknown',
        evidence_ids: deadline.value ? [`ev-deadline-${index + 1}`] : [],
      },
      location,
      platform,
      entry_link: entryLink,
      required_materials: materials,
      consequence: null,
      obligation: /必须|须|截止|务必/.test(text) ? 'mandatory' : 'unknown',
      evidence: actionEvidence,
      confidence: { score: warnings.length === 0 ? 0.9 : 0.45, basis: 'rule_review' },
      epistemic_status: 'explicit',
      field_status: fieldStatus,
      result_stage: 'rule_reviewed',
      verification_status: status,
      task_status: 'pending',
      change_history: [
        {
          change_id: randomUUID(),
          occurred_at: startedAt,
          actor: 'rule_engine',
          change_type: 'created',
          reason: 'Deterministic rule parser output',
        },
      ],
    };
  });
  const shieldErrors = parsedActions.flatMap((action) => inspectCriticalErrors(action));
  for (const shieldError of shieldErrors) {
    const code = `CRITICAL_${shieldError.code}`;
    if (!warnings.some((warning) => warning.code === code)) {
      warnings.push({
        code,
        message: shieldError.message,
        paths: [`/verified_actions/*/${shieldError.field}`],
      });
    }
  }
  const assessmentEvidence = relevanceEvidence
    ? [
        {
          evidence_id: relevanceEvidence.evidence_id,
          source_text: relevanceEvidence.source_text,
          field_name: 'user_relevance' as const,
        },
      ]
    : [];
  const executableActions = userRelevance === 'irrelevant' ? [] : parsedActions;
  const completedAt = new Date().toISOString();
  const response: TextParseResponse = {
    schema_version: 'text-parse-response/v1',
    request_id: request.request_id,
    document_id: request.document.document_id,
    status:
      actionInputs.length === 0
        ? 'rejected'
        : warnings.length > 0
          ? 'needs_confirmation'
          : 'succeeded',
    document_assessment: {
      schema_version: 'document-assessment/v1',
      document_id: request.document.document_id,
      user_relevance: userRelevance,
      relevance_reason:
        userRelevance === 'relevant'
          ? '用户画像匹配适用对象'
          : userRelevance === 'irrelevant'
            ? '用户画像未匹配适用对象'
            : '相关性需要用户确认',
      evidence: assessmentEvidence,
      verification_status:
        userRelevance === 'relevant' && warnings.length === 0
          ? 'passed'
          : userRelevance === 'irrelevant'
            ? 'passed'
            : 'user_confirmation_required',
    },
    verified_actions: executableActions,
    action_graph:
      executableActions.length > 0
        ? buildGraph(executableActions, request.document.document_id)
        : null,
    warnings,
    parser_metadata: {
      parser_version: 'rule-parser/1.0.0',
      model_provider: 'deterministic-rule-engine',
      model_version: 'not_applicable',
      prompt_version: 'not_applicable',
      rule_version: 'rule-set/1.0.0',
      ocr_version: 'not_applicable',
      started_at: startedAt,
      completed_at: completedAt,
      latency_ms: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
    },
    ...(request.execution_context.environment === 'production'
      ? {}
      : { provenance: { development_only: true, synthetic: true, not_model_output: true } }),
  };
  const validResponse = validateTextParseResponse(response);
  if (!validResponse.ok)
    return {
      code: 'INVALID_REQUEST',
      message: `rule parser generated invalid response: ${validResponse.errors[0]?.message ?? 'unknown error'}`,
    };
  return validResponse.value;
}

function buildGraph(actions: VerifiedActionObject[], documentId: string): ActionGraph {
  const nodes: ActionGraph['nodes'] = actions.map((action) => ({
    node_id: `${action.action_id}:node`,
    node_type: 'action' as const,
    action_id: action.action_id,
  }));
  const edges: ActionGraph['edges'] = nodes.slice(1).map((node, index) => ({
    edge_id: `${documentId}:edge:${index + 1}`,
    from_node_id: nodes[index].node_id,
    to_node_id: node.node_id,
    edge_type: 'blocks' as const,
  }));
  let branchIndex = 0;
  for (const action of actions) {
    for (const condition of action.conditions) {
      branchIndex += 1;
      const decisionNodeId = `${action.action_id}:decision:${condition.condition_id}`;
      nodes.push({
        node_id: decisionNodeId,
        node_type: 'decision',
        condition_ids: [condition.condition_id],
      });
      edges.push({
        edge_id: `${documentId}:branch:${branchIndex}`,
        from_node_id: decisionNodeId,
        to_node_id: `${action.action_id}:node`,
        edge_type: 'branches_to',
        condition_id: condition.condition_id,
      });
    }
  }
  return { schema_version: 'action-graph/v1', graph_id: `${documentId}:graph`, nodes, edges };
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
