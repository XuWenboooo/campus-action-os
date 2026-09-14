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
};

function safeDivide(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

export function f1(precision: number, recall: number): number {
  return safeDivide(2 * precision * recall, precision + recall);
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
  return {
    sample_count: count,
    failed_count: records.filter((record) => record.parse_failed).length,
    action_precision: actionPrecision,
    action_recall: actionRecall,
    action_f1: f1(actionPrecision, actionRecall),
    deadline_exact_match: safeDivide(deadlineCorrect, count),
    relevance_accuracy: safeDivide(relevanceCorrect, count),
    evidence_coverage: safeDivide(records.reduce((sum, record) => sum + record.evidence_coverage, 0), count),
    critical_error_rate: safeDivide(records.filter((record) => record.critical_error).length, count),
    unsupported_critical_claim_rate: safeDivide(records.reduce((sum, record) => sum + record.unsupported_critical_claims, 0), criticalClaims),
  };
}
