import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / 'tools' / 'benchmark' / 'phase3b_pipeline.py'
SPEC = importlib.util.spec_from_file_location('phase3b_pipeline', MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def candidate(**changes):
    value = {
        'candidate_id': 'CABV1-RECONSTRUCTED-001',
        'source_type': 'authorized_reconstructed',
        'source_provenance': 'authorized-fictional-source',
        'authorization_record_id': 'AUTH-001',
        'collection_timestamp': '2026-09-15T00:00:00Z',
        'data_origin': 'reconstructed',
        'privacy_status': 'DEIDENTIFIED',
        'document_sha256': 'a' * 64,
        'near_duplicate_fingerprint': 'fingerprint-001',
        'category_tags': ['academic'],
        'revision_family_id': None,
        'deidentification_status': 'APPROVED',
    }
    value.update(changes)
    return value


def authorization(status='AUTHORIZED'):
    return {
        'authorization_record_id': 'AUTH-001',
        'source': 'authorized-fictional-source',
        'authorization_status': status,
        'allowed_usage': 'benchmark-development',
        'privacy_restrictions': 'synthetic-reconstruction-only',
        'collection_date': '2026-09-15',
        'provenance': 'controlled-fixture',
    }


class Phase3BPipelineTest(unittest.TestCase):
    def write_jsonl(self, path, rows):
        path.write_text('\n'.join(json.dumps(row, ensure_ascii=False) for row in rows) + '\n', encoding='utf-8')

    def test_synthetic_candidate_is_never_eligible_for_formal_pool(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            candidates = root / 'candidates.jsonl'
            authorizations = root / 'authorizations.jsonl'
            self.write_jsonl(candidates, [candidate(data_origin='synthetic', source_type='synthetic_development')])
            self.write_jsonl(authorizations, [authorization()])
            report = MODULE.audit_candidates(candidates, authorizations)
            self.assertEqual(report['authorized_candidates'], 0)
            self.assertEqual(report['status'], 'BLOCKED')
            self.assertTrue(any('synthetic' in reason for item in report['rejections'] for reason in item['reasons']))

    def test_pending_authorization_and_unapproved_deidentification_are_blocked(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            candidates = root / 'candidates.jsonl'
            authorizations = root / 'authorizations.jsonl'
            self.write_jsonl(candidates, [candidate(deidentification_status='PENDING')])
            self.write_jsonl(authorizations, [authorization(status='PENDING')])
            report = MODULE.audit_candidates(candidates, authorizations)
            self.assertEqual(report['authorized_candidates'], 0)
            self.assertEqual(report['status'], 'BLOCKED')
            reasons = report['rejections'][0]['reasons']
            self.assertTrue(any('PENDING' in reason for reason in reasons))

    def test_authorized_deidentified_reconstruction_can_enter_ready_pool(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            candidates = root / 'candidates.jsonl'
            authorizations = root / 'authorizations.jsonl'
            self.write_jsonl(candidates, [candidate()])
            self.write_jsonl(authorizations, [authorization()])
            report = MODULE.audit_candidates(candidates, authorizations)
            self.assertEqual(report['status'], 'READY')
            self.assertEqual(report['authorized_candidates'], 1)
            batches = MODULE.plan_batches([candidate()], 25)
            self.assertEqual(batches['batch_count'], 1)
            self.assertEqual(batches['batches'][0]['count'], 1)

    def test_batch_size_is_bounded_and_empty_pool_is_blocked(self):
        with self.assertRaises(ValueError):
            MODULE.plan_batches([candidate()], 10)
        with self.assertRaises(ValueError):
            MODULE.plan_batches([], 25)

    def test_malformed_json_objects_and_unhashable_fields_fail_closed(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            candidates = root / 'candidates.jsonl'
            authorizations = root / 'authorizations.jsonl'
            self.write_jsonl(candidates, [None, ['not-an-object'], candidate(source_type=['invalid'])])
            self.write_jsonl(authorizations, [['not-an-object'], authorization(status=['invalid'])])
            report = MODULE.audit_candidates(candidates, authorizations)
            self.assertEqual(report['status'], 'BLOCKED')
            self.assertEqual(report['authorized_candidates'], 0)
            self.assertTrue(report['errors'])
            self.assertTrue(report['rejections'])
        with self.assertRaises(ValueError):
            MODULE.plan_batches([['not-an-object']], 25)


if __name__ == '__main__':
    unittest.main()
