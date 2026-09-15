#!/usr/bin/env python3
"""Fail-closed intake and batch gates for the formal CampusActionBench pool."""
import argparse
import hashlib
import json
import re
import sys
from collections import Counter
from pathlib import Path


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


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode('utf-8')).hexdigest()


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
    return 2


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(json.dumps({'status': 'BLOCKED', 'error': str(error)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
