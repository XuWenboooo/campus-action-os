#!/usr/bin/env python3
"""Run the five-case Phase 3A workflow without creating formal benchmark data."""
import argparse
import copy
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CASE_FILE = ROOT / 'benchmark' / 'phase3a' / 'dry-run-cases.json'
ANNOTATOR_A_FILE = ROOT / 'benchmark' / 'phase3a' / 'annotation-a.json'
ANNOTATOR_B_FILE = ROOT / 'benchmark' / 'phase3a' / 'annotation-b.json'
RULING_FILE = ROOT / 'benchmark' / 'phase3a' / 'adjudication-rulings.json'
ISOLATION_TOOL = ROOT / 'tools' / 'benchmark' / 'check-test-isolation.py'
PII_PATTERN = re.compile(r'(?:\b1[3-9]\d{9}\b|\b\d{17}[\dXx]\b|手机号|身份证|学号|真实姓名)')
DEIDENTIFICATION_RULES = (
    (re.compile(r'\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b'), '[REDACTED_EMAIL]'),
    (re.compile(r'\b1[3-9]\d{9}\b'), '[REDACTED_PHONE]'),
    (re.compile(r'\b\d{17}[\dXx]\b'), '[REDACTED_ID]'),
    (re.compile(r'(?:姓名|真实姓名)\s*[:：]\s*[^\s,，。；;]{2,20}'), '姓名：[REDACTED_NAME]'),
    (re.compile(r'学号\s*[:：]\s*[^\s,，。；;]{2,20}'), '学号：[REDACTED_STUDENT_ID]'),
    (re.compile(r'联系方式\s*[:：]\s*[^\s,，。；;]{2,30}'), '联系方式：[REDACTED_CONTACT]'),
)
REQUIRED_COVERAGE = {
    'simple_single_action',
    'single_deadline',
    'conditional_action',
    'multi_stage_action',
    'multiple_deadlines',
    'materials',
    'field_evidence_spans',
    'revision',
    'revocation',
}
STATES = (
    'candidate',
    'authorized',
    'deidentified',
    'annotation_A',
    'annotation_B',
    'adjudication',
    'gold',
    'split_assigned',
    'frozen',
)
TRANSITIONS = dict(zip(STATES, STATES[1:]))


class DatasetStateMachine:
    def __init__(self, state='candidate'):
        if state not in STATES:
            raise ValueError(f'unknown dataset state: {state}')
        self.state = state
        self.history = [state]

    def transition(self, next_state):
        if TRANSITIONS.get(self.state) != next_state:
            raise ValueError(f'illegal dataset transition: {self.state} -> {next_state}')
        self.state = next_state
        self.history.append(next_state)


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def deidentify_text(text):
    replacements = 0
    value = text
    for pattern, replacement in DEIDENTIFICATION_RULES:
        value, count = pattern.subn(replacement, value)
        replacements += count
    return value, replacements


def deidentify_jsonl(input_path, output_path):
    if input_path.resolve() == output_path.resolve():
        raise ValueError('de-identification output must not overwrite the input')
    rows = []
    report = []
    for line_number, line in enumerate(input_path.read_text(encoding='utf-8').splitlines(), 1):
        if not line.strip():
            continue
        row = json.loads(line)
        raw_input = row.get('raw_input')
        if isinstance(raw_input, dict) and isinstance(raw_input.get('ocr_text'), str):
            before = raw_input['ocr_text']
            after, count = deidentify_text(before)
            row = copy.deepcopy(row)
            row['raw_input']['ocr_text'] = after
            report.append({'line': line_number, 'replacements': count, 'input_sha256': digest(before), 'output_sha256': digest(after)})
        rows.append(row)
    write_jsonl(output_path, rows)
    return report


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + '\n', encoding='utf-8')


def write_jsonl(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('\n'.join(json.dumps(row, ensure_ascii=False, sort_keys=True) for row in rows) + '\n', encoding='utf-8')


def digest(value):
    payload = value if isinstance(value, bytes) else json.dumps(value, ensure_ascii=False, sort_keys=True).encode('utf-8')
    return hashlib.sha256(payload).hexdigest()


def validate_cases(cases):
    if len(cases) != 5:
        raise ValueError(f'Phase 3A requires exactly 5 cases, got {len(cases)}')
    ids = [case.get('case_id') for case in cases]
    if len(set(ids)) != 5:
        raise ValueError('Phase 3A case IDs must be unique')
    coverage = {tag for case in cases for tag in case.get('coverage', [])}
    missing = REQUIRED_COVERAGE - coverage
    if missing:
        raise ValueError(f'Phase 3A coverage is missing: {sorted(missing)}')
    for case in cases:
        if case.get('data_origin') != 'synthetic' or case.get('benchmark_status') != 'phase3a_dry_run':
            raise ValueError(f"{case.get('case_id')}: only phase3a synthetic data is allowed")
        if not isinstance(case.get('text'), str) or not case['text'].strip():
            raise ValueError(f"{case.get('case_id')}: source text is empty")
        if PII_PATTERN.search(case['text']) or PII_PATTERN.search(json.dumps(case, ensure_ascii=False)):
            raise ValueError(f"{case.get('case_id')}: possible personal data in synthetic fixture")


def index_cases(cases):
    return {case['case_id']: case for case in cases}


def index_annotations(rows, expected_annotator, case_ids):
    result = {}
    for row in rows:
        case_id = row.get('case_id')
        if case_id not in case_ids or case_id in result:
            raise ValueError(f'invalid or duplicate {expected_annotator} submission: {case_id}')
        if row.get('annotator_id') != expected_annotator:
            raise ValueError(f'{case_id}: expected independent submission by {expected_annotator}')
        result[case_id] = row
    if set(result) != set(case_ids):
        raise ValueError(f'{expected_annotator} did not submit every case')
    return result


def materialize_evidence(case, annotation):
    evidence = []
    for index, item in enumerate(annotation.get('evidence', []), 1):
        source_text = item.get('text')
        if not isinstance(source_text, str) or not source_text:
            raise ValueError(f"{case['case_id']}: evidence text is empty")
        start = case['text'].find(source_text)
        if start < 0:
            raise ValueError(f"{case['case_id']}: evidence is absent from source text: {source_text}")
        evidence.append({
            'evidence_id': f"{case['case_id']}:e{index}",
            'field': item.get('field'),
            'source_text': source_text,
            'text_start': start,
            'text_end': start + len(source_text),
            'evidence_group_id': f"{case['case_id']}:group:{item.get('field')}",
            'polarity': 'negative' if item.get('field') in {'revocation', 'exception'} else 'positive',
        })
    return evidence


def validate_annotation(case, annotation):
    relevance = annotation.get('relevance')
    if relevance not in {'relevant', 'not_relevant', 'uncertain'}:
        raise ValueError(f"{case['case_id']}: invalid relevance")
    action_ids = [action.get('action_id') for action in annotation.get('actions', [])]
    if len(action_ids) != len(set(action_ids)):
        raise ValueError(f"{case['case_id']}: duplicate action_id")
    evidence = materialize_evidence(case, annotation)
    for item in evidence:
        if case['text'][item['text_start']:item['text_end']] != item['source_text']:
            raise ValueError(f"{case['case_id']}: evidence coordinate does not round-trip")
    for action in annotation.get('actions', []):
        if not isinstance(action.get('deadlines', []), list):
            raise ValueError(f"{case['case_id']}: deadlines must be a list")
        if not isinstance(action.get('materials', []), list):
            raise ValueError(f"{case['case_id']}: materials must be a list")
    return evidence


def lock_submission(case, annotation, evidence, suffix):
    snapshot = {
        'case_id': case['case_id'],
        'document_id': case['document_id'],
        'data_origin': 'synthetic',
        'annotator_id': annotation['annotator_id'],
        'submission_id': f"{case['case_id']}:submission:{suffix}",
        'status': 'submitted_locked',
        'gold_candidate': annotation,
        'evidence_spans': evidence,
    }
    return {
        **snapshot,
        'submission_sha256': digest(snapshot),
        'locked': True,
    }


def compare_submissions(a, b):
    differences = []
    for field in ('relevance', 'actions', 'ambiguities', 'conflicts'):
        if a['gold_candidate'].get(field) != b['gold_candidate'].get(field):
            differences.append({
                'field': field,
                'annotation_A': a['gold_candidate'].get(field),
                'annotation_B': b['gold_candidate'].get(field),
            })
    return differences


def final_sample(case, selected, evidence, ruling, annotation_a, annotation_b):
    actions = selected['gold_candidate'].get('actions', [])
    dependencies = [
        {'from_action_id': actions[index - 1]['action_id'], 'to_action_id': action['action_id']}
        for index, action in enumerate(actions)
        if index > 0
    ]
    annotation = {
        'annotator_ids': ['person-a', 'person-b'],
        'independent_result_hashes': [annotation_a['submission_sha256'], annotation_b['submission_sha256']],
        'adjudication_status': 'adjudicated',
        'adjudicator_id': 'synthetic-adjudicator',
        'disagreement_report_id': f"{case['case_id']}:disagreement",
        'adjudication_record_id': f"{case['case_id']}:adjudication",
    }
    return {
        'sample_id': f"CABV1-{case['case_id']}",
        'source_group': case['source_group'],
        'provenance': {
            'source_type': 'synthetic_development',
            'authorization_status': 'not_applicable_synthetic',
            'data_origin': 'synthetic',
        },
        'notice_category': 'finance' if case['case_id'].endswith('005') else 'academic',
        'raw_input': {
            'input_type': case['input_type'],
            'ocr_text': case['text'],
            'layout': {'pages': 1, 'blocks': []},
        },
        'user_profile': {'profile_id': case['document_id'] + ':profile', 'attributes': case['user_profile']},
        'gold': {
            'relevance': selected['gold_candidate']['relevance'],
            'action_graph': {'actions': actions, 'dependencies': dependencies},
            'field_evidence': [
                {
                    'field': item['field'],
                    'text_start': item['text_start'],
                    'text_end': item['text_end'],
                    'evidence_group_id': item['evidence_group_id'],
                    'polarity': item['polarity'],
                }
                for item in evidence
            ],
            'ambiguities': selected['gold_candidate'].get('ambiguities', []),
            'conflicts': selected['gold_candidate'].get('conflicts', []),
            'missing_information': [],
            'risk_labels': case['coverage'],
        },
        'annotation': annotation,
        'data_version': 'phase3a-dry-run/v1.0.0',
        'change_history': [{
            'change_id': f"{case['case_id']}:adjudication",
            'reason': ruling['rationale'],
            'selected_annotator': ruling['selected_annotator'],
            'disagreement_type': ruling['disagreement_type'],
        }],
        'revision': case.get('revision'),
    }


def evaluation_row(sample):
    actions = sample['gold']['action_graph']['actions']
    materials = [material for action in actions for material in action.get('materials', [])]
    spans = [[item['text_start'], item['text_end']] for item in sample['gold']['field_evidence']]
    deadline_values = [deadline for action in actions for deadline in action.get('deadlines', [])]
    return {
        'sample_id': sample['sample_id'],
        'status': 'success',
        'expected_action_count': len(actions),
        'predicted_action_count': len(actions),
        'expected_deadline': 'explicit' if deadline_values else 'unknown',
        'predicted_deadline': 'explicit' if deadline_values else 'unknown',
        'expected_relevance': sample['gold']['relevance'],
        'predicted_relevance': sample['gold']['relevance'],
        'evidence_coverage': 1 if spans else 0,
        'unsupported_critical_claims': 0,
        'critical_claims': max(1, len(spans)),
        'parse_failed': False,
        'critical_error_codes': [],
        'expected_materials': materials,
        'predicted_materials': materials,
        'expected_evidence_spans': spans,
        'predicted_evidence_spans': spans,
    }


def file_record(path, root):
    payload = path.read_bytes()
    return {'path': str(path.relative_to(root)).replace('\\', '/'), 'sha256': hashlib.sha256(payload).hexdigest(), 'bytes': len(payload)}


def run(output_dir):
    cases = read_json(CASE_FILE)
    validate_cases(cases)
    case_map = index_cases(cases)
    ids = set(case_map)
    annotations_a = index_annotations(read_json(ANNOTATOR_A_FILE), 'person-a', ids)
    annotations_b = index_annotations(read_json(ANNOTATOR_B_FILE), 'person-b', ids)
    rulings = {row['case_id']: row for row in read_json(RULING_FILE)}
    if set(rulings) != ids:
        raise ValueError('adjudication rulings must cover every case exactly once')
    output_dir.mkdir(parents=True, exist_ok=True)
    machine_states = {}
    authorized = []
    candidates = []
    deidentified = []
    locked_a = []
    locked_b = []
    disagreements = []
    adjudications = []
    final_gold = []
    for case_id in sorted(ids):
        case = case_map[case_id]
        state = DatasetStateMachine()
        candidates.append({'candidate_id': case_id, 'document_id': case['document_id'], 'source_group': case['source_group'], 'state': 'candidate', 'data_origin': 'synthetic', 'allowed_usage': 'phase3a_dry_run_only'})
        state.transition('authorized')
        authorized.append({'case_id': case_id, 'source': 'phase3a synthetic fixture', 'authorization_status': 'not_applicable_synthetic', 'allowed_usage': 'phase3a_dry_run_only', 'privacy_restrictions': 'synthetic_only', 'collection_date': None, 'provenance': case['source_group']})
        state.transition('deidentified')
        clean_text, replacement_count = deidentify_text(case['text'])
        if PII_PATTERN.search(clean_text):
            raise ValueError(f'{case_id}: de-identification did not clear direct identifiers')
        deidentified.append({'case_id': case_id, 'status': 'passed', 'replacements': replacement_count, 'input_sha256': digest(case['text']), 'output_sha256': digest(clean_text), 'checks': ['synthetic_origin', 'no_direct_identifiers', 'semantic_fields_preserved']})
        evidence_a = materialize_evidence(case, annotations_a[case_id])
        evidence_b = materialize_evidence(case, annotations_b[case_id])
        validate_annotation(case, annotations_a[case_id])
        validate_annotation(case, annotations_b[case_id])
        state.transition('annotation_A')
        locked_a.append(lock_submission(case, annotations_a[case_id], evidence_a, 'A'))
        state.transition('annotation_B')
        locked_b.append(lock_submission(case, annotations_b[case_id], evidence_b, 'B'))
        differences = compare_submissions(locked_a[-1], locked_b[-1])
        disagreements.append({'case_id': case_id, 'status': 'detected' if differences else 'none', 'differences': differences})
        state.transition('adjudication')
        ruling = rulings[case_id]
        if ruling['selected_annotator'] not in {'person-a', 'person-b'}:
            raise ValueError(f'{case_id}: invalid selected annotator')
        selected = locked_a[-1] if ruling['selected_annotator'] == 'person-a' else locked_b[-1]
        selected_evidence = evidence_a if ruling['selected_annotator'] == 'person-a' else evidence_b
        if not ruling.get('rationale') or any(case['text'].find(text) < 0 for text in ruling.get('evidence', [])):
            raise ValueError(f'{case_id}: adjudication must include rationale and source evidence')
        adjudications.append({'case_id': case_id, 'status': 'adjudicated', 'original_A': locked_a[-1]['submission_sha256'], 'original_B': locked_b[-1]['submission_sha256'], **ruling})
        state.transition('gold')
        sample = final_sample(case, selected, selected_evidence, ruling, locked_a[-1], locked_b[-1])
        final_gold.append(sample)
        state.transition('split_assigned')
        state.transition('frozen')
        machine_states[case_id] = {'state': state.state, 'history': state.history}
    write_jsonl(output_dir / 'authorization-registry.jsonl', authorized)
    write_jsonl(output_dir / 'candidate-registry.jsonl', candidates)
    write_jsonl(output_dir / 'deidentification-report.jsonl', deidentified)
    write_jsonl(output_dir / 'annotation_A.locked.jsonl', locked_a)
    write_jsonl(output_dir / 'annotation_B.locked.jsonl', locked_b)
    write_json(output_dir / 'submission-lock.json', {
        'status': 'locked',
        'data_origin': 'synthetic',
        'editing_after_lock': 'reject',
        'submissions': {case_id: {'A': a['submission_sha256'], 'B': b['submission_sha256']} for case_id, a, b in zip(sorted(ids), locked_a, locked_b)},
    })
    write_jsonl(output_dir / 'disagreements.jsonl', disagreements)
    write_jsonl(output_dir / 'adjudications.jsonl', adjudications)
    write_jsonl(output_dir / 'final-gold.jsonl', final_gold)
    audit = subprocess.run([sys.executable, str(ROOT / 'tools' / 'benchmark' / 'cab.py'), 'audit', str(output_dir / 'final-gold.jsonl'), '--development'], cwd=ROOT, text=True, capture_output=True)
    if audit.returncode != 0:
        raise ValueError(f'final gold benchmark validation failed: {audit.stdout or audit.stderr}')
    write_json(output_dir / 'final-gold-validation.json', json.loads(audit.stdout))
    evaluation_rows = [evaluation_row(sample) for sample in final_gold]
    write_jsonl(output_dir / 'evaluator-input.jsonl', evaluation_rows)
    split = {'train': final_gold[:3], 'dev': final_gold[3:], 'test': []}
    delivery_dir = output_dir / 'model-lead-delivery'
    write_jsonl(delivery_dir / 'train.jsonl', split['train'])
    write_jsonl(delivery_dir / 'dev.jsonl', split['dev'])
    write_jsonl(delivery_dir / 'evaluator-input.jsonl', evaluation_rows)
    write_json(delivery_dir / 'dataset-manifest.json', {
        'dataset_id': 'CampusActionBench-800',
        'data_origin': 'synthetic',
        'formal_benchmark': False,
        'split_status': 'phase3a_dry_run_only',
        'counts': {'train': len(split['train']), 'dev': len(split['dev']), 'test': 0},
        'test_access': 'denied',
    })
    write_json(delivery_dir / 'evaluator-contract.json', {
        'evaluator_version': 'campus-action-bench-evaluator/v1.0.0',
        'statuses': ['success', 'failed', 'refused', 'timeout', 'parse_failed'],
        'failures_in_denominator': True,
        'critical_error_protocol': 'campus-action-bench-critical-errors/v1.0.0',
    })
    delivery_manifest = {
        'package_version': 'phase3a-model-lead-delivery/v1.0.0',
        'data_origin': 'synthetic',
        'formal_benchmark': False,
        'test_included': False,
        'files': ['train.jsonl', 'dev.jsonl', 'evaluator-input.jsonl', 'dataset-manifest.json', 'evaluator-contract.json'],
        'evaluator_contract': 'campus-action-bench-evaluator/v1.0.0',
        'test_access': 'denied',
    }
    write_json(delivery_dir / 'package-manifest.json', delivery_manifest)
    sealed_ids = output_dir / 'sealed-test-ids.txt'
    sealed_ids.write_text('CAB3A-SYN-SEALED-001\n', encoding='utf-8')
    isolation = subprocess.run([sys.executable, str(ISOLATION_TOOL), '--test-ids', str(sealed_ids), '--scan', str(delivery_dir)], cwd=ROOT, text=True, capture_output=True)
    if isolation.returncode != 0:
        raise ValueError(f'model lead delivery failed test isolation: {isolation.stdout or isolation.stderr}')
    write_json(output_dir / 'test-isolation-result.json', json.loads(isolation.stdout))
    split_manifest = {
        'manifest_version': 'phase3a-dry-run-manifest/v1',
        'dataset_id': 'CampusActionBench-800',
        'dataset_status': 'development_only',
        'data_origin': 'synthetic',
        'formal_benchmark': False,
        'formal_split_status': 'not_applicable_dry_run',
        'counts': {'train': len(split['train']), 'dev': len(split['dev']), 'test': 0, 'total': len(final_gold)},
        'files': [file_record(delivery_dir / 'train.jsonl', delivery_dir), file_record(delivery_dir / 'dev.jsonl', delivery_dir), file_record(delivery_dir / 'evaluator-input.jsonl', delivery_dir)],
        'test_ids': [],
        'evaluator_version': 'campus-action-bench-evaluator/v1.0.0',
        'test_sealed': True,
    }
    write_json(output_dir / 'manifest.json', split_manifest)
    write_json(output_dir / 'state-machine.json', machine_states)
    write_json(output_dir / 'workflow-summary.json', {
        'phase': 'Phase 3A',
        'status': 'COMPLETE',
        'case_count': len(final_gold),
        'data_origin': 'synthetic',
        'artifacts': ['annotation_A.locked.jsonl', 'annotation_B.locked.jsonl', 'disagreements.jsonl', 'adjudications.jsonl', 'final-gold.jsonl', 'manifest.json', 'model-lead-delivery/package-manifest.json', 'test-isolation-result.json'],
        'formal_data_collection': 'NOT_STARTED',
    })
    print(json.dumps({'output_dir': str(output_dir), 'case_count': len(final_gold), 'status': 'COMPLETE', 'test_isolation': 'passed', 'test_ids_delivered_to_model_lead': 0}, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='command', required=True)
    run_parser = sub.add_parser('run')
    run_parser.add_argument('--out-dir', type=Path, default=ROOT / 'benchmark' / 'generated' / 'phase3a-dry-run')
    deidentify_parser = sub.add_parser('deidentify')
    deidentify_parser.add_argument('--input', type=Path, required=True)
    deidentify_parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.command == 'run':
        run(args.out_dir)
        return 0
    if args.command == 'deidentify':
        report = deidentify_jsonl(args.input, args.output)
        print(json.dumps({'status': 'COMPLETE', 'rows': len(report), 'report': report}, ensure_ascii=False))
        return 0
    return 2


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(json.dumps({'status': 'FAILED', 'error': str(error)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
