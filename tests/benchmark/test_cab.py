import json, subprocess, sys, tempfile
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[2]
TOOL=ROOT/'tools'/'benchmark'/'cab.py'
SAMPLE=ROOT/'benchmark'/'dev_samples.jsonl'

def run(*args): return subprocess.run([sys.executable,str(TOOL),*map(str,args)],cwd=ROOT,text=True,capture_output=True)

class BenchmarkToolsTest(unittest.TestCase):
    def test_audit_reports_coverage_and_passes_dev_samples(self):
        r=run('audit',SAMPLE); self.assertNotEqual(r.returncode,0)  # tiny dev fixture intentionally fails production balance gate
        report=json.loads(r.stdout); self.assertEqual(report['total'],2); self.assertIn('ocr_review',report['coverage'])

    def test_split_is_stable_and_keeps_lineage_together(self):
        with tempfile.TemporaryDirectory() as td:
            a=Path(td)/'a'; b=Path(td)/'b'
            self.assertEqual(run('split',SAMPLE,'--out-dir',a,'--seed',7).returncode,0)
            self.assertEqual(run('split',SAMPLE,'--out-dir',b,'--seed',7).returncode,0)
            self.assertEqual((a/'split-manifest.json').read_bytes(),(b/'split-manifest.json').read_bytes())
            sets=[]
            for n in ('development','validation','test'):
                sets.append({x['source_group'] for x in (json.loads(l) for l in (a/f'{n}.jsonl').read_text(encoding='utf-8').splitlines() if l.strip())})
            self.assertFalse(sets[0]&sets[1] or sets[0]&sets[2] or sets[1]&sets[2])

    def test_freeze_verify_and_refuse_overwrite(self):
        with tempfile.TemporaryDirectory() as td:
            td=Path(td); test=td/'test.jsonl'; cfg=td/'config.json'; ver=td/'version.txt'; man=td/'manifest.json'
            test.write_text('CABV1-SYN-001\n'); cfg.write_text('{}'); ver.write_text('dev-commit-placeholder')
            self.assertEqual(run('freeze',test,cfg,ver,'--manifest',man).returncode,0)
            self.assertEqual(run('verify',man,test).returncode,0)
            self.assertNotEqual(run('freeze',test,cfg,ver,'--manifest',man).returncode,0)
            test.write_text('tampered\n'); self.assertNotEqual(run('verify',man,test).returncode,0)

    def test_audit_expected_size_and_cross_dataset_risk(self):
        with tempfile.TemporaryDirectory() as td:
            other=Path(td)/'other.jsonl'; other.write_text((SAMPLE.read_text(encoding='utf-8').splitlines()[0]+'\n'),encoding='utf-8')
            r=run('audit',SAMPLE,'--expected','--compare',other)
            report=json.loads(r.stdout); self.assertNotEqual(r.returncode,0)
            self.assertTrue(report['cross_dataset_duplicates']['exact'])

if __name__=='__main__': unittest.main()
