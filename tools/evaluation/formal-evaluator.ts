import { scoreRecords, type EvaluationRecord } from './metrics.js';

export const FORMAL_EVALUATOR_VERSION = 'campus-action-bench-evaluator/v1.0.0';

export const EVALUATION_STATUSES = [
  'success',
  'failed',
  'refused',
  'timeout',
  'parse_failed',
] as const;

export type EvaluationStatus = (typeof EVALUATION_STATUSES)[number];

export const CRITICAL_ERROR_CODES = [
  'FABRICATED_DEADLINE',
  'DEADLINE_BOUNDARY_EXPANSION',
  'AUDIENCE_SCOPE_ERROR',
  'UNSUPPORTED_MATERIAL',
  'FABRICATED_PLATFORM',
  'MERGED_DEADLINES',
  'CONDITION_DROPPED',
  'RECOMMENDATION_AS_REQUIREMENT',
  'POSSIBILITY_AS_CERTAINTY',
  'CONFLICT_AS_CERTAINTY',
  'REVOKED_ACTION_ACTIVE',
] as const;

export type CriticalErrorCode = (typeof CRITICAL_ERROR_CODES)[number];

export type FormalEvaluationRecord = Omit<
  EvaluationRecord,
  | 'critical_error'
  | 'expected_materials'
  | 'predicted_materials'
  | 'expected_evidence_spans'
  | 'predicted_evidence_spans'
> & {
  status: EvaluationStatus;
  critical_error_codes: CriticalErrorCode[];
  expected_materials: string[];
  predicted_materials: string[];
  expected_evidence_spans: Array<[number, number]>;
  predicted_evidence_spans: Array<[number, number]>;
};

function assertRecord(record: FormalEvaluationRecord): void {
  if (!record.sample_id.trim()) throw new Error('Formal evaluation record requires sample_id');
  if (!EVALUATION_STATUSES.includes(record.status))
    throw new Error(`Unsupported evaluation status: ${record.status}`);
  if (new Set(record.critical_error_codes).size !== record.critical_error_codes.length)
    throw new Error(`Duplicate Critical Error code in ${record.sample_id}`);
  for (const code of record.critical_error_codes) {
    if (!CRITICAL_ERROR_CODES.includes(code))
      throw new Error(`Unsupported Critical Error code: ${code}`);
  }
  for (const spans of [record.expected_evidence_spans, record.predicted_evidence_spans]) {
    for (const span of spans) {
      if (!Number.isInteger(span[0]) || !Number.isInteger(span[1]) || span[0] < 0 || span[1] < span[0])
        throw new Error(`Invalid evidence span in ${record.sample_id}`);
    }
  }
}

export function scoreFormalRecords(records: FormalEvaluationRecord[]) {
  if (records.length === 0) throw new Error('Formal evaluation requires at least one record');
  records.forEach(assertRecord);
  const ids = new Set(records.map((record) => record.sample_id));
  if (ids.size !== records.length) throw new Error('Formal evaluation sample_id values must be unique');

  const normalized: EvaluationRecord[] = records.map((record) => ({
    ...record,
    critical_error: record.critical_error_codes.length > 0,
  }));
  const statusCounts = Object.fromEntries(
    EVALUATION_STATUSES.map((status) => [status, records.filter((record) => record.status === status).length]),
  );
  const criticalErrorCounts = Object.fromEntries(
    CRITICAL_ERROR_CODES.map((code) => [
      code,
      records.filter((record) => record.critical_error_codes.includes(code)).length,
    ]),
  );
  return {
    evaluator_version: FORMAL_EVALUATOR_VERSION,
    metric_semantics: {
      action: 'micro',
      materials: 'micro',
      evidence_spans: 'micro_exact_half_open_span',
      relevance: 'sample_macro',
      deadlines: 'sample_macro_exact',
      critical_errors: 'sample_macro_any_code',
      failures_in_denominator: true,
    },
    status_counts: statusCounts,
    critical_error_counts: criticalErrorCounts,
    metrics: scoreRecords(normalized),
  };
}
