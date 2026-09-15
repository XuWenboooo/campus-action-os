#!/usr/bin/env python3
"""Fail-closed intake and batch gates for the formal CampusActionBench pool."""
import argparse
import copy
import hashlib
import json
import re
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker


FORMAL_ORIGINS = {'real', 'reconstructed'}
FORMAL_SOURCE_TYPES = {'authorized_real', 'authorized_reconstructed'}
AUTHORIZATION_STATUSES = {'AUTHORIZED', 'PENDING', 'REJECTED', 'RESTRICTED'}
DEIDENTIFICATION_STATUSES = {'APPROVED', 'PENDING', 'REJECTED'}
SAMPLE_ID = re.compile(r'^CABV1-[A-Z0-9-]+$')
SHA256 = re.compile(r'^[0-9a-f]{64}$')
DIRECT_IDENTIFIER = re.compile(r'(?:\b1[3-9]\d{9}\b|\b\d{17}[\dXx]\b|手机号|身份证|学号|真实姓名|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})')
REQUIRED_CANDIDATE_FIELDS = (
    'candidate_id',
    'source_type',
    'source_provenance',
    'authorization_record_id',
    'collection_timestamp',
    'data_origin',
    'privacy_status',
    'document_sha256',
    'near_duplicate_fingerprint',
    'category_tags',
    'revision_family_id',
    'deidentification_status',
)
TARGET_BATCH_MIN = 25
TARGET_BATCH_MAX = 50
FORMAL_SAMPLE_COUNT = 800
FORMAL_SPLIT_COUNTS = {'train': 480, 'dev': 160, 'test': 160}
FORMAL_MANIFEST_SCHEMA = Path(__file__).resolve().parents[2] / 'benchmark' / 'schema' / 'campus-action-bench-manifest-v1.schema.json'
FORMAL_PROTOCOLS = {
    'dataset': 'campus-action-bench-protocol/v1.0.0',
    'annotation': 'campus-action-bench-annotation/v1.0.0',
    'evidence': 'campus-action-bench-evidence/v1.0.0',
    'split': 'campus-action-bench-split/v1.0.0',
    'evaluator': 'campus-action-bench-evaluator/v1.0.0',
    'critical_errors': 'campus-action-bench-critical-errors/v1.0.0',
}
REGISTRY_FIELDS = (
    'sample_id',
    'split',
    'data_origin',
    'document_sha256',
    'authorization_status',
    'deidentification_status',
    'annotation_a_status',
    'annotation_b_status',
    'adjudication_status',
    'gold_status',
    'evidence_status',
    'source_category',
    'duplicate_family_id',
    'revision_family_id',
    'external_review_status',
)
REGISTRY_COMPLETION = {
    'authorization_status': 'AUTHORIZED',
    'deidentification_status': 'APPROVED',
    'annotation_a_status': 'LOCKED',
    'annotation_b_status': 'LOCKED',
    'adjudication_status': 'ADJUDICATED',
    'gold_status': 'VALIDATED',
    'evidence_status': 'VALIDATED',
    'external_review_status': 'NONE',
}


def load_jsonl(path):
    rows = []
    for line_number, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
        if not line.strip():
            continue
        try:
            rows.append((line_number, json.loads(line)))
        except json.JSONDecodeError as error:
            rows.append((line_number, {'__parse_error__': str(error)}))
    return rows


def is_parse_error(row):
    return isinstance(row, dict) and '__parse_error__' in row


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + '\n', encoding='utf-8')


def file_digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def relative_path(path, root):
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError as error:
        raise ValueError(f'file must be under manifest root: {path}') from error


def file_record(path, root, record_count):
    if not path.is_file():
        raise ValueError(f'required formal artifact is missing: {path}')
    return {
        'path': relative_path(path, root),
        'sha256': file_digest(path),
        'bytes': path.stat().st_size,
        'record_count': record_count,
    }


def load_json(path):
    try:
        value = json.loads(path.read_text(encoding='utf-8'))
    except json.JSONDecodeError as error:
        raise ValueError(f'invalid JSON: {path}: {error}') from error
    if not isinstance(value, dict):
        raise ValueError(f'JSON artifact must be an object: {path}')
    return value


def registry_record_errors(row):
    if not isinstance(row, dict):
        return ['record must be a JSON object']
    missing = [field for field in REGISTRY_FIELDS if field not in row]
    if missing:
        return [f"missing fields: {','.join(missing)}"]
    errors = []
    sample_id = row['sample_id']
    if not isinstance(sample_id, str) or not SAMPLE_ID.fullmatch(sample_id):
        errors.append('sample_id must be a stable CABV1-* ID')
    if not isinstance(row['split'], str) or row['split'] not in FORMAL_SPLIT_COUNTS:
        errors.append('split must be train, dev, or test')
    if not isinstance(row['data_origin'], str) or row['data_origin'] not in FORMAL_ORIGINS:
        errors.append('data_origin must be real or reconstructed')
    if not isinstance(row['document_sha256'], str) or not SHA256.fullmatch(row['document_sha256']):
        errors.append('document_sha256 must be a lowercase SHA-256')
    for field, expected in REGISTRY_COMPLETION.items():
        if row[field] != expected:
            errors.append(f'{field} must be {expected}')
    for field in ('source_category', 'duplicate_family_id'):
        if not isinstance(row[field], str) or not row[field].strip():
            errors.append(f'{field} must be a non-empty string')
    if row['revision_family_id'] is not None and (not isinstance(row['revision_family_id'], str) or not row['revision_family_id'].strip()):
        errors.append('revision_family_id must be null or a non-empty string')
    return errors


def load_formal_registry(path):
    rows = load_jsonl(path)
    records = []
    errors = []
    seen = set()
    for line_number, row in rows:
        if is_parse_error(row):
            errors.append(f'registry line {line_number}: invalid JSON')
            continue
        row_errors = registry_record_errors(row)
        if isinstance(row, dict) and isinstance(row.get('sample_id'), str):
            sample_id = row['sample_id']
            if sample_id in seen:
                row_errors.append('duplicate sample_id')
            seen.add(sample_id)
        else:
            sample_id = f'line-{line_number}'
        if row_errors:
            errors.extend([f'{sample_id}: {message}' for message in row_errors])
        else:
            records.append(row)
    return records, errors


def load_split_ids(path, expected_split):
    ids = []
    errors = []
    for line_number, row in load_jsonl(path):
        if is_parse_error(row):
            errors.append(f'{expected_split} line {line_number}: invalid JSON')
            continue
        if not isinstance(row, dict):
            errors.append(f'{expected_split} line {line_number}: record must be a JSON object')
            continue
        sample_id = row.get('sample_id')
        if not isinstance(sample_id, str):
            errors.append(f'{expected_split} line {line_number}: sample_id is required')
            continue
        ids.append(sample_id)
    duplicates = [sample_id for sample_id, count in Counter(ids).items() if count > 1]
    if duplicates:
        errors.append(f'{expected_split}: duplicate sample IDs: {", ".join(sorted(duplicates))}')
    return ids, errors


def issue_count(value):
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    if isinstance(value, list):
        return len(value)
    return None


def validate_leakage_gate(path):
    report = load_json(path)
    required = ('tool', 'tool_version', 'passed', 'exact_duplicates', 'near_duplicates', 'cross_source_groups', 'reviewer_ids')
    missing = [field for field in required if field not in report]
    if missing:
        raise ValueError(f'leakage report missing fields: {", ".join(missing)}')
    if report['tool'] != 'cab.py' or report['tool_version'] != 'cab/2.0.0':
        raise ValueError('leakage report must be produced by cab.py 2.0.0')
    if report['passed'] is not True:
        raise ValueError('leakage audit did not pass')
    for field in ('exact_duplicates', 'near_duplicates', 'cross_source_groups'):
        count = issue_count(report[field])
        if count != 0:
            raise ValueError(f'leakage audit has non-zero {field}: {count}')
    reviewers = report['reviewer_ids']
    if not isinstance(reviewers, list) or len(set(item for item in reviewers if isinstance(item, str))) < 2:
        raise ValueError('leakage report requires two distinct reviewers')
    return report


def validate_test_seal(path):
    proof = load_json(path)
    if proof.get('status') != 'SEALED':
        raise ValueError('test seal proof must have status SEALED')
    if proof.get('sample_count') != FORMAL_SPLIT_COUNTS['test']:
        raise ValueError('test seal proof must cover exactly 160 samples')
    if not isinstance(proof.get('sealed_at'), str) or not proof['sealed_at'].strip():
        raise ValueError('test seal proof requires sealed_at')
    if not isinstance(proof.get('authorized_by'), list) or not proof['authorized_by']:
        raise ValueError('test seal proof requires authorized_by')
    return proof


def validate_manifest(value):
    schema = json.loads(FORMAL_MANIFEST_SCHEMA.read_text(encoding='utf-8'))
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    return [error.message for error in sorted(validator.iter_errors(value), key=lambda item: list(item.path))]


def manifest_digest(value):
    unsigned = copy.deepcopy(value)
    unsigned['freeze']['manifest_sha256'] = '0' * 64
    payload = json.dumps(unsigned, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
    return hashlib.sha256(payload).hexdigest()


def build_formal_manifest(registry_path, split_paths, leakage_path, seal_path, config_path, output_path, dataset_version, code_commit, reviewers, frozen_at, root):
    if output_path.exists():
        raise ValueError(f'refusing to overwrite existing manifest: {output_path}')
    records, registry_errors = load_formal_registry(registry_path)
    if len(records) != FORMAL_SAMPLE_COUNT:
        registry_errors.append(f'formal manifest requires exactly {FORMAL_SAMPLE_COUNT} valid registry records, got {len(records)}')
    if registry_errors:
        raise ValueError('formal manifest gate blocked: ' + '; '.join(registry_errors[:10]))
    if len(set(reviewers)) < 2:
        raise ValueError('manifest requires two distinct reviewers')
    if not isinstance(code_commit, str) or not re.fullmatch(r'[0-9a-f]{40}', code_commit):
        raise ValueError('code_commit must be a lowercase 40-character commit hash')
    if not isinstance(dataset_version, str) or not re.fullmatch(r'\d+\.\d+\.\d+', dataset_version):
        raise ValueError('dataset_version must use semver')
    try:
        parsed_frozen_at = datetime.fromisoformat(frozen_at.replace('Z', '+00:00'))
        if parsed_frozen_at.tzinfo is None:
            raise ValueError
    except ValueError as error:
        raise ValueError('frozen_at must be an ISO-8601 timestamp') from error

    registry_by_id = {row['sample_id']: row for row in records}
    split_ids = {}
    split_errors = []
    for split, path in split_paths.items():
        ids, errors = load_split_ids(path, split)
        split_ids[split] = ids
        split_errors.extend(errors)
        if len(ids) != FORMAL_SPLIT_COUNTS[split]:
            split_errors.append(f'{split}: expected {FORMAL_SPLIT_COUNTS[split]} records, got {len(ids)}')
        for sample_id in ids:
            if sample_id not in registry_by_id:
                split_errors.append(f'{split}: sample_id is absent from registry: {sample_id}')
            elif registry_by_id[sample_id]['split'] != split:
                split_errors.append(f'{sample_id}: registry split does not match {split}')
    if len(set(sample_id for ids in split_ids.values() for sample_id in ids)) != FORMAL_SAMPLE_COUNT:
        split_errors.append('split files must contain 800 unique sample IDs')
    if split_errors:
        raise ValueError('formal split gate blocked: ' + '; '.join(split_errors[:10]))

    leakage = validate_leakage_gate(leakage_path)
    validate_test_seal(seal_path)
    root = root.resolve()
    files = [file_record(split_paths[split], root, FORMAL_SPLIT_COUNTS[split]) for split in ('train', 'dev', 'test')]
    registry_file = file_record(registry_path, root, FORMAL_SAMPLE_COUNT)
    config_sha256 = file_digest(config_path)
    manifest = {
        'manifest_version': 'campus-action-bench-manifest/v1',
        'dataset_id': 'CampusActionBench-800',
        'dataset_version': dataset_version,
        'status': 'frozen',
        'total_samples': FORMAL_SAMPLE_COUNT,
        'splits': FORMAL_SPLIT_COUNTS,
        'files': files,
        'sample_registry': {
            **registry_file,
            'records': [
                {
                    'sample_id': row['sample_id'],
                    'split': row['split'],
                    'data_origin': row['data_origin'],
                    'document_sha256': row['document_sha256'],
                    'authorization_status': row['authorization_status'],
                    'deidentification_status': row['deidentification_status'],
                    'annotation_a_status': row['annotation_a_status'],
                    'annotation_b_status': row['annotation_b_status'],
                    'adjudication_status': row['adjudication_status'],
                    'gold_status': row['gold_status'],
                    'evidence_status': row['evidence_status'],
                    'source_category': row['source_category'],
                    'duplicate_family_id': row['duplicate_family_id'],
                    'revision_family_id': row['revision_family_id'],
                    'external_review_status': row['external_review_status'],
                }
                for row in sorted(records, key=lambda item: item['sample_id'])
            ],
        },
        'quality': {
            'authorized': FORMAL_SAMPLE_COUNT,
            'deidentified': FORMAL_SAMPLE_COUNT,
            'annotation_a': FORMAL_SAMPLE_COUNT,
            'annotation_b': FORMAL_SAMPLE_COUNT,
            'adjudicated': FORMAL_SAMPLE_COUNT,
            'gold_validated': FORMAL_SAMPLE_COUNT,
            'evidence_validated': FORMAL_SAMPLE_COUNT,
            'pending_external_review': 0,
        },
        'protocols': FORMAL_PROTOCOLS,
        'leakage_audit': {
            'tool': leakage['tool'],
            'tool_version': leakage['tool_version'],
            'passed': True,
            'exact_duplicates': 0,
            'near_duplicates': 0,
            'cross_source_groups': 0,
            'reviewer_ids': sorted(set(leakage['reviewer_ids'])),
        },
        'freeze': {
            'code_commit': code_commit,
            'config_sha256': config_sha256,
            'frozen_at': frozen_at,
            'manifest_sha256': '',
            'reviewer_ids': sorted(set(reviewers)),
            'test_read_only': True,
        },
    }
    manifest['freeze']['manifest_sha256'] = manifest_digest(manifest)
    schema_errors = validate_manifest(manifest)
    if schema_errors:
        raise ValueError('generated formal manifest failed schema validation: ' + '; '.join(schema_errors[:10]))
    write_json(output_path, manifest)
    return manifest


def load_authorizations(path):
    records = {}
    errors = []
    for line_number, row in load_jsonl(path):
        if is_parse_error(row):
            errors.append(f'authorization line {line_number}: invalid JSON')
            continue
        if not isinstance(row, dict):
            errors.append(f'authorization line {line_number}: record must be a JSON object')
            continue
        required = ('authorization_record_id', 'source', 'authorization_status', 'allowed_usage', 'privacy_restrictions', 'collection_date', 'provenance')
        missing = [field for field in required if field not in row]
        if missing:
            errors.append(f"authorization line {line_number}: missing {','.join(missing)}")
            continue
        record_id = row['authorization_record_id']
        if not isinstance(record_id, str) or not record_id or record_id in records:
            errors.append(f'authorization line {line_number}: invalid or duplicate authorization_record_id')
            continue
        if not isinstance(row['authorization_status'], str) or row['authorization_status'] not in AUTHORIZATION_STATUSES:
            errors.append(f"authorization line {line_number}: unknown authorization status")
        records[record_id] = row
    return records, errors


def candidate_errors(row, authorization):
    if not isinstance(row, dict):
        return ['candidate record must be a JSON object']
    errors = []
    missing = [field for field in REQUIRED_CANDIDATE_FIELDS if field not in row]
    if missing:
        errors.append(f"missing fields: {','.join(missing)}")
        return errors
    candidate_id = row['candidate_id']
    if not isinstance(candidate_id, str) or not SAMPLE_ID.fullmatch(candidate_id):
        errors.append('candidate_id must be a stable CABV1-* ID')
    if not isinstance(row['source_type'], str) or row['source_type'] not in FORMAL_SOURCE_TYPES:
        errors.append('source_type is not a formal authorized source type')
    if not isinstance(row['data_origin'], str) or row['data_origin'] not in FORMAL_ORIGINS:
        errors.append('synthetic data cannot enter the formal candidate pool')
    authorization_id = row['authorization_record_id']
    if not isinstance(authorization_id, str) or authorization_id not in authorization:
        errors.append('authorization record is missing')
    else:
        record = authorization[authorization_id]
        if record['authorization_status'] != 'AUTHORIZED':
            errors.append(f"authorization status is {record['authorization_status']}, not AUTHORIZED")
        if record.get('source') != row.get('source_provenance'):
            errors.append('candidate provenance does not match authorization source')
    if row['privacy_status'] != 'DEIDENTIFIED':
        errors.append('privacy_status must be DEIDENTIFIED')
    if row['deidentification_status'] != 'APPROVED':
        errors.append(f"deidentification status is {row['deidentification_status']}, not APPROVED")
    if not isinstance(row['document_sha256'], str) or not SHA256.fullmatch(row['document_sha256']):
        errors.append('document_sha256 must be a lowercase SHA-256')
    if not isinstance(row['near_duplicate_fingerprint'], str) or not row['near_duplicate_fingerprint'].strip():
        errors.append('near_duplicate_fingerprint is required')
    if not isinstance(row['category_tags'], list) or not row['category_tags']:
        errors.append('category_tags must be non-empty')
    if 'raw_input' in row and isinstance(row['raw_input'], dict):
        text = row['raw_input'].get('ocr_text', '')
        if isinstance(text, str) and DIRECT_IDENTIFIER.search(text):
            errors.append('deidentified candidate still contains a direct identifier')
    return errors


def audit_candidates(input_path, authorization_path):
    authorizations, authorization_errors = load_authorizations(authorization_path)
    rows = load_jsonl(input_path)
    errors = list(authorization_errors)
    candidates = []
    rejected = []
    seen = set()
    for line_number, row in rows:
        if is_parse_error(row):
            errors.append(f'candidate line {line_number}: invalid JSON')
            continue
        candidate_id = row.get('candidate_id', f'line-{line_number}') if isinstance(row, dict) else f'line-{line_number}'
        comparable_id = candidate_id if isinstance(candidate_id, str) else f'line-{line_number}'
        if comparable_id in seen:
            rejected.append({'candidate_id': candidate_id, 'reasons': ['duplicate candidate_id']})
            continue
        seen.add(comparable_id)
        reasons = candidate_errors(row, authorizations)
        if reasons:
            rejected.append({'candidate_id': candidate_id, 'reasons': reasons})
        else:
            candidates.append(row)
    fingerprint_collisions = []
    fingerprint_index = {}
    for row in candidates:
        fingerprint = row['near_duplicate_fingerprint']
        if fingerprint in fingerprint_index:
            fingerprint_collisions.append([fingerprint_index[fingerprint], row['candidate_id']])
        fingerprint_index[fingerprint] = row['candidate_id']
    if fingerprint_collisions:
        errors.append(f'near_duplicate_fingerprint collisions: {len(fingerprint_collisions)}')
    status = 'READY' if candidates and not errors and not rejected else 'BLOCKED'
    return {
        'pipeline': 'campus-action-bench-phase3b',
        'pipeline_version': '1.0.0',
        'status': status,
        'formal_data_origin_only': True,
        'input_count': len([row for _, row in rows if not is_parse_error(row)]),
        'authorized_candidates': len(candidates),
        'rejected_candidates': len(rejected),
        'authorization_records': len(authorizations),
        'authorization_status_counts': dict(
            Counter(
                status if isinstance(status, str) and status in AUTHORIZATION_STATUSES else 'INVALID'
                for status in (record.get('authorization_status') for record in authorizations.values())
            )
        ),
        'rejections': rejected,
        'errors': errors,
        'near_duplicate_collisions': fingerprint_collisions,
        'eligible_candidate_ids': [row['candidate_id'] for row in candidates],
    }


def plan_batches(rows, batch_size):
    if not TARGET_BATCH_MIN <= batch_size <= TARGET_BATCH_MAX:
        raise ValueError(f'batch size must be between {TARGET_BATCH_MIN} and {TARGET_BATCH_MAX}')
    if not rows:
        raise ValueError('cannot create formal annotation batches from zero candidates')
    if any(not isinstance(row, dict) or not isinstance(row.get('candidate_id'), str) for row in rows):
        raise ValueError('every batch candidate must be a JSON object with a stable candidate_id')
    batches = [rows[index:index + batch_size] for index in range(0, len(rows), batch_size)]
    return {
        'status': 'READY',
        'batch_size': batch_size,
        'batch_count': len(batches),
        'batches': [{'batch_id': f'CAB3B-BATCH-{index + 1:03d}', 'count': len(batch), 'candidate_ids': [row['candidate_id'] for row in batch]} for index, batch in enumerate(batches)],
    }


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='command', required=True)
    audit_parser = sub.add_parser('audit-candidates')
    audit_parser.add_argument('--input', required=True, type=Path)
    audit_parser.add_argument('--authorization', required=True, type=Path)
    audit_parser.add_argument('--out', type=Path)
    batch_parser = sub.add_parser('plan-batches')
    batch_parser.add_argument('--input', required=True, type=Path)
    batch_parser.add_argument('--batch-size', required=True, type=int)
    manifest_parser = sub.add_parser('freeze-manifest')
    manifest_parser.add_argument('--sample-registry', required=True, type=Path)
    manifest_parser.add_argument('--train', required=True, type=Path)
    manifest_parser.add_argument('--dev', required=True, type=Path)
    manifest_parser.add_argument('--test', required=True, type=Path)
    manifest_parser.add_argument('--leakage-report', required=True, type=Path)
    manifest_parser.add_argument('--test-seal-proof', required=True, type=Path)
    manifest_parser.add_argument('--config', required=True, type=Path)
    manifest_parser.add_argument('--code-commit', required=True)
    manifest_parser.add_argument('--reviewer-id', action='append', required=True)
    manifest_parser.add_argument('--dataset-version', required=True)
    manifest_parser.add_argument('--frozen-at', required=True)
    manifest_parser.add_argument('--root', type=Path, default=Path.cwd())
    manifest_parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    if args.command == 'audit-candidates':
        report = audit_candidates(args.input, args.authorization)
        if args.out:
            write_json(args.out, report)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0 if report['status'] == 'READY' else 1
    if args.command == 'plan-batches':
        rows = [row for _, row in load_jsonl(args.input) if not is_parse_error(row)]
        report = plan_batches(rows, args.batch_size)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    if args.command == 'freeze-manifest':
        manifest = build_formal_manifest(
            registry_path=args.sample_registry,
            split_paths={'train': args.train, 'dev': args.dev, 'test': args.test},
            leakage_path=args.leakage_report,
            seal_path=args.test_seal_proof,
            config_path=args.config,
            output_path=args.out,
            dataset_version=args.dataset_version,
            code_commit=args.code_commit,
            reviewers=args.reviewer_id,
            frozen_at=args.frozen_at,
            root=args.root,
        )
        print(json.dumps({'status': 'FROZEN', 'manifest_sha256': manifest['freeze']['manifest_sha256'], 'output': str(args.out)}, ensure_ascii=False, indent=2))
        return 0
    return 2


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(json.dumps({'status': 'BLOCKED', 'error': str(error)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
