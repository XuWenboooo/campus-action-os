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


def annotation(sample_id, annotator_id, workspace_id, relevance='relevant'):
    value = {
        'sample_id': sample_id,
        'annotator_id': annotator_id,
        'workspace_id': workspace_id,
        'submitted_at': '2026-09-15T01:00:00Z',
        'status': 'submitted_locked',
        'locked': True,
        'gold_candidate': {
            'relevance': relevance,
            'actions': [{
                'action_id': 'a1',
                'verb': 'submit',
                'object': '课程回顾',
                'deadlines': [],
                'materials': [],
                'conditions': [],
                'exceptions': [],
            }],
            'ambiguities': [],
            'conflicts': [],
            'missing_information': [],
            'risk_labels': [],
        },
        'evidence_spans': [{
            'field': 'action',
            'source_text': '提交课程回顾',
            'text_start': 0,
            'text_end': 6,
            'evidence_group_id': 'e1',
            'polarity': 'positive',
        }],
    }
    value['submission_sha256'] = MODULE.submission_hash(value)
    return value


def formal_candidate():
    return candidate(
        source_group='authorized-source-group-001',
        notice_category='academic',
        raw_input={'input_type': 'text', 'ocr_text': '提交课程回顾', 'layout': {'pages': 1, 'blocks': []}},
        user_profile={'profile_id': 'profile-001', 'attributes': {'enrollment': 'student'}},
    )


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

    def test_formal_manifest_freeze_refuses_incomplete_registry(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            registry = root / 'sample-registry.jsonl'
            output = root / 'manifest.json'
            registry.write_text('', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'requires exactly 800'):
                MODULE.build_formal_manifest(
                    registry_path=registry,
                    split_paths={'train': registry, 'dev': registry, 'test': registry},
                    leakage_path=registry,
                    seal_path=registry,
                    config_path=registry,
                    output_path=output,
                    dataset_version='1.0.0',
                    code_commit='a' * 40,
                    reviewers=['person-a', 'person-b'],
                    frozen_at='2026-09-15T00:00:00Z',
                    root=root,
                )
            self.assertFalse(output.exists())

    def test_assemble_batch_locks_independent_annotations_and_materializes_gold(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            sample = formal_candidate()
            candidates = root / 'candidates.jsonl'
            annotation_a = root / 'annotation-a.jsonl'
            annotation_b = root / 'annotation-b.jsonl'
            adjudication = root / 'adjudication.jsonl'
            self.write_jsonl(candidates, [sample])
            a = annotation(sample['candidate_id'], 'person-a', 'workspace-a')
            b = annotation(sample['candidate_id'], 'person-b', 'workspace-b', relevance='uncertain')
            self.write_jsonl(annotation_a, [a])
            self.write_jsonl(annotation_b, [b])
            self.write_jsonl(adjudication, [{
                'sample_id': sample['candidate_id'],
                'adjudication_status': 'ADJUDICATED',
                'original_A_hash': a['submission_sha256'],
                'original_B_hash': b['submission_sha256'],
                'adjudicator_id': 'person-adjudicator',
                'adjudicated_at': '2026-09-15T02:00:00Z',
                'selected_submission': 'A',
                'disagreement_type': ['relevance'],
                'evidence': ['提交课程回顾'],
                'rationale': 'The source supports the actionable interpretation.',
            }])
            report = MODULE.assemble_formal_batch(candidates, annotation_a, annotation_b, adjudication)
            self.assertEqual(report['status'], 'READY')
            self.assertEqual(report['quality']['disagreement_count'], 1)
            self.assertEqual(report['quality']['agreement']['evidence_spans']['agreement_count'], 1)
            self.assertEqual(len(report['samples']), 1)
            self.assertEqual(report['samples'][0]['annotation']['adjudication_status'], 'adjudicated')
            MODULE.validate_benchmark_sample(report['samples'][0])

    def test_assemble_batch_keeps_pending_adjudication_out_of_gold(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            sample = formal_candidate()
            candidates = root / 'candidates.jsonl'
            annotation_a = root / 'annotation-a.jsonl'
            annotation_b = root / 'annotation-b.jsonl'
            adjudication = root / 'adjudication.jsonl'
            self.write_jsonl(candidates, [sample])
            a = annotation(sample['candidate_id'], 'person-a', 'workspace-a')
            b = annotation(sample['candidate_id'], 'person-b', 'workspace-b')
            self.write_jsonl(annotation_a, [a])
            self.write_jsonl(annotation_b, [b])
            self.write_jsonl(adjudication, [{
                'sample_id': sample['candidate_id'],
                'adjudication_status': 'PENDING_EXTERNAL_REVIEW',
                'original_A_hash': a['submission_sha256'],
                'original_B_hash': b['submission_sha256'],
                'adjudicator_id': 'person-adjudicator',
                'adjudicated_at': '2026-09-15T02:00:00Z',
                'pending_reason': 'Source is insufficient to resolve the disagreement.',
                'rationale': 'Do not infer a gold value.',
            }])
            report = MODULE.assemble_formal_batch(candidates, annotation_a, annotation_b, adjudication)
            self.assertEqual(report['status'], 'BLOCKED')
            self.assertEqual(report['pending_sample_ids'], [sample['candidate_id']])
            self.assertEqual(report['samples'], [])


if __name__ == '__main__':
    unittest.main()
