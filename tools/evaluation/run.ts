import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type TextParseRequest, type UserProfile } from '@campus-action-os/protocol';
import { inspectCriticalErrors } from '../../services/ai-parser/src/error-shield.js';
import { parseText, type ParserFailure } from '../../services/ai-parser/src/rule-parser.js';
import { scoreRecords, type EvaluationRecord } from './metrics.js';

type Fixture = {
  fixture_id: string;
  data_origin: string;
  benchmark_status: string;
  text: string;
  user_profile?: UserProfile;
  expected: {
    relevance: 'relevant' | 'irrelevant' | 'uncertain';
    deadline: 'explicit' | 'unknown';
    action_count?: number;
    materials?: string[];
    evidence_spans?: Array<[number, number]>;
  };
};

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const fixtures = JSON.parse(
  readFileSync(resolve(root, 'datasets/fixtures/synthetic-notifications.json'), 'utf8'),
) as Fixture[];

function evidenceSpans(text: string, sourceTexts: string[]): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const seen = new Set<string>();
  for (const sourceText of sourceTexts) {
    let start = text.indexOf(sourceText);
    while (start >= 0) {
      const span: [number, number] = [start, start + sourceText.length];
      const key = `${span[0]}:${span[1]}`;
      if (!seen.has(key)) {
        seen.add(key);
        spans.push(span);
      }
      start = text.indexOf(sourceText, start + 1);
    }
  }
  return spans;
}

const records: EvaluationRecord[] = [];
const raw: unknown[] = [];
for (const fixture of fixtures) {
  if (fixture.data_origin !== 'synthetic' || fixture.benchmark_status !== 'development_only')
    throw new Error(`Unsafe fixture metadata: ${fixture.fixture_id}`);
  const request: TextParseRequest = {
    schema_version: 'text-parse-request/v1',
    request_id: `evaluation:${fixture.fixture_id}`,
    idempotency_key: `evaluation:${fixture.fixture_id}`,
    protocol_version: '1.0.0',
    document: {
      document_id: fixture.fixture_id,
      content_type: 'text/plain',
      text: fixture.text,
      content_sha256: createHash('sha256').update(fixture.text).digest('hex'),
      language: 'zh-CN',
      timezone: 'Asia/Shanghai',
    },
    user_profile: fixture.user_profile ?? { education_level: '本科生' },
    execution_context: {
      environment: 'test',
      deadline_ms: 5000,
      requested_at: new Date().toISOString(),
    },
  };
  const result = parseText(request);
  const parsed = 'code' in result ? null : result;
  const failure = 'code' in result ? (result as ParserFailure) : null;
  const failed = parsed === null;
  const action = parsed?.verified_actions[0] ?? null;
  const shieldErrors = action ? inspectCriticalErrors(action) : [];
  const warningCodes = parsed?.warnings.map((warning) => warning.code) ?? [];
  const errorCodes = failure ? [failure.code] : warningCodes;
  records.push({
    sample_id: fixture.fixture_id,
    expected_action_count: fixture.expected.action_count ?? 1,
    predicted_action_count: parsed?.verified_actions.length ?? 0,
    expected_deadline: fixture.expected.deadline,
    predicted_deadline: failed ? 'failed' : action?.deadline.value ? 'explicit' : 'unknown',
    expected_relevance: fixture.expected.relevance,
    predicted_relevance: failed ? 'failed' : parsed.document_assessment.user_relevance,
    evidence_coverage: action ? (action.evidence.length > 0 ? 1 : 0) : 0,
    critical_error: failed || Boolean(action?.verification_status === 'conflict'),
    unsupported_critical_claims: shieldErrors.filter(
      (error) => error.code === 'UNSUPPORTED_CLAIM',
    ).length,
    critical_claims: action ? Math.max(1, action.evidence.length) : 1,
    parse_failed: failed,
    expected_materials: fixture.expected.materials,
    predicted_materials: action?.required_materials.map((material) => material.description),
    expected_evidence_spans: fixture.expected.evidence_spans,
    predicted_evidence_spans: action
      ? evidenceSpans(
          fixture.text,
          action.evidence.map((item) => item.source_text),
        )
      : [],
    error_codes: errorCodes,
  });
  raw.push({
    fixture_id: fixture.fixture_id,
    data_origin: fixture.data_origin,
    user_profile: request.user_profile,
    result,
    shield_errors: shieldErrors,
  });
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputDirectory = resolve(root, 'benchmark/results', `synthetic-${timestamp}`);
mkdirSync(outputDirectory, { recursive: true });
const report = {
  evaluation_version: 'local-synthetic-eval/1.1.0',
  dataset: 'datasets/fixtures/synthetic-notifications.json',
  dataset_origin: 'synthetic',
  development_only: true,
  records,
  metrics: scoreRecords(records),
};
writeFileSync(resolve(outputDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(resolve(outputDirectory, 'raw-results.json'), `${JSON.stringify(raw, null, 2)}\n`);
const manifest = [resolve(outputDirectory, 'report.json'), resolve(outputDirectory, 'raw-results.json')]
  .map(
    (file) =>
      `${createHash('sha256').update(readFileSync(file)).digest('hex')}  ${file.split('benchmark\\results\\').at(-1) ?? file.split('benchmark/results/').at(-1)}`,
  )
  .join('\n');
writeFileSync(resolve(outputDirectory, 'manifest.sha256'), `${manifest}\n`);
console.log(JSON.stringify({ output_directory: outputDirectory, ...report.metrics }));
