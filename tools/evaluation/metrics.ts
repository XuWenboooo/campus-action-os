export type EvaluationRecord = {
  sample_id: string;
  expected_action_count: number;
  predicted_action_count: number;
  expected_deadline: 'explicit' | 'unknown';
  predicted_deadline: 'explicit' | 'unknown' | 'failed';
  expected_relevance: 'relevant' | 'irrelevant' | 'uncertain';
  predicted_relevance: 'relevant' | 'irrelevant' | 'uncertain' | 'failed';
  evidence_coverage: number;
  critical_error: boolean;
  unsupported_critical_claims: number;
  critical_claims: number;
  parse_failed: boolean;
  expected_materials?: string[];
  predicted_materials?: string[];
  expected_evidence_spans?: Array<[number, number]>;
  predicted_evidence_spans?: Array<[number, number]>;
  error_codes?: string[];
};

function safeDivide(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

export function f1(precision: number, recall: number): number {
  return safeDivide(2 * precision * recall, precision + recall);
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function matchedCount(expected: string[], predicted: string[]): number {
  const remaining = predicted.map(normalized);
  let matched = 0;
  for (const value of expected.map(normalized)) {
    const index = remaining.indexOf(value);
    if (index === -1) continue;
    matched += 1;
    remaining.splice(index, 1);
  }
  return matched;
}

function exactSpanKey(span: [number, number]): string {
  return `${span[0]}:${span[1]}`;
}

function matchedSpanCount(expected: Array<[number, number]>, predicted: Array<[number, number]>): number {
  const remaining = predicted.map(exactSpanKey);
  let matched = 0;
  for (const span of expected) {
    const index = remaining.indexOf(exactSpanKey(span));
    if (index === -1) continue;
    matched += 1;
    remaining.splice(index, 1);
  }
  return matched;
}

export function scoreRecords(records: EvaluationRecord[]) {
  const count = records.length;
  const actionExpected = records.reduce((sum, record) => sum + record.expected_action_count, 0);
  const actionPredicted = records.reduce((sum, record) => sum + record.predicted_action_count, 0);
  const actionMatched = records.reduce((sum, record) => sum + Math.min(record.expected_action_count, record.predicted_action_count), 0);
  const actionPrecision = safeDivide(actionMatched, actionPredicted);
  const actionRecall = safeDivide(actionMatched, actionExpected);
  const relevanceCorrect = records.filter((record) => record.expected_relevance === record.predicted_relevance).length;
  const deadlineCorrect = records.filter((record) => record.expected_deadline === record.predicted_deadline).length;
  const criticalClaims = records.reduce((sum, record) => sum + record.critical_claims, 0);
  const materialRecords = records.filter(
    (record) => record.expected_materials !== undefined && record.predicted_materials !== undefined,
  );
  const materialExpected = materialRecords.reduce(
    (sum, record) => sum + (record.expected_materials?.length ?? 0),
    0,
  );
  const materialPredicted = materialRecords.reduce(
    (sum, record) => sum + (record.predicted_materials?.length ?? 0),
    0,
  );
  const materialMatched = materialRecords.reduce(
    (sum, record) =>
      sum + matchedCount(record.expected_materials ?? [], record.predicted_materials ?? []),
    0,
  );
  const evidenceSpanRecords = records.filter(
    (record) =>
      record.expected_evidence_spans !== undefined && record.predicted_evidence_spans !== undefined,
  );
  const evidenceExpected = evidenceSpanRecords.reduce(
    (sum, record) => sum + (record.expected_evidence_spans?.length ?? 0),
    0,
  );
  const evidencePredicted = evidenceSpanRecords.reduce(
    (sum, record) => sum + (record.predicted_evidence_spans?.length ?? 0),
    0,
  );
  const evidenceMatched = evidenceSpanRecords.reduce(
    (sum, record) =>
      sum +
      matchedSpanCount(record.expected_evidence_spans ?? [], record.predicted_evidence_spans ?? []),
    0,
  );
  const materialPrecision = safeDivide(materialMatched, materialPredicted);
  const materialRecall = safeDivide(materialMatched, materialExpected);
  const evidenceSpanPrecision = safeDivide(evidenceMatched, evidencePredicted);
  const evidenceSpanRecall = safeDivide(evidenceMatched, evidenceExpected);
  return {
    sample_count: count,
    failed_count: records.filter((record) => record.parse_failed).length,
    action_precision: actionPrecision,
    action_recall: actionRecall,
    action_f1: f1(actionPrecision, actionRecall),
    deadline_exact_match: safeDivide(deadlineCorrect, count),
    relevance_accuracy: safeDivide(relevanceCorrect, count),
    material_annotated_count: materialRecords.length,
    material_precision: materialRecords.length ? materialPrecision : null,
    material_recall: materialRecords.length ? materialRecall : null,
    material_f1: materialRecords.length ? f1(materialPrecision, materialRecall) : null,
    evidence_coverage: safeDivide(records.reduce((sum, record) => sum + record.evidence_coverage, 0), count),
    evidence_span_annotated_count: evidenceSpanRecords.length,
    evidence_span_precision: evidenceSpanRecords.length ? evidenceSpanPrecision : null,
    evidence_span_recall: evidenceSpanRecords.length ? evidenceSpanRecall : null,
    evidence_span_f1: evidenceSpanRecords.length ? f1(evidenceSpanPrecision, evidenceSpanRecall) : null,
    critical_error_rate: safeDivide(records.filter((record) => record.critical_error).length, count),
    unsupported_critical_claim_rate: safeDivide(records.reduce((sum, record) => sum + record.unsupported_critical_claims, 0), criticalClaims),
  };
}
