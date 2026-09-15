import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
TOOL = ROOT / 'tools' / 'benchmark' / 'check-test-isolation.py'


def run(ids, scan):
    return subprocess.run(
        [sys.executable, str(TOOL), '--test-ids', str(ids), '--scan', str(scan)],
        cwd=ROOT,
        text=True,
        capture_output=True,
    )


class TestPhase3Isolation(unittest.TestCase):
    def test_isolation_allows_aggregate_metadata_without_test_ids(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            ids = root / 'sealed-test-ids.txt'
            scan = root / 'experiments'
            scan.mkdir()
            ids.write_text('CAB-TEST-001\nCAB-TEST-002\n', encoding='utf-8')
            (scan / 'run.json').write_text(
                json.dumps({'sample_count': 160, 'evaluator_version': 'v1', 'manifest_hash': 'a' * 64}),
                encoding='utf-8',
            )
            result = run(ids, scan)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(json.loads(result.stdout)['matches'], [])


    def test_isolation_fails_when_a_test_id_enters_training_workflow(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            ids = root / 'sealed-test-ids.txt'
            scan = root / 'train'
            scan.mkdir()
            ids.write_text('CAB-TEST-001\n', encoding='utf-8')
            (scan / 'output.json').write_text('{"sample_id":"CAB-TEST-001"}\n', encoding='utf-8')
            result = run(ids, scan)
            report = json.loads(result.stdout)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(report['passed'])
            self.assertEqual(report['matches'][0]['sample_id'], 'CAB-TEST-001')
