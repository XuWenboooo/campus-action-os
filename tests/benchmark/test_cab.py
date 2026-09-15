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
            self.assertTrue(any('formal audit requires real or reconstructed data' in item for item in report['errors']))

    def test_audit_validates_each_sample_against_the_benchmark_schema(self):
        with tempfile.TemporaryDirectory() as td:
            invalid=Path(td)/'invalid.jsonl'
            sample=json.loads(SAMPLE.read_text(encoding='utf-8').splitlines()[0])
            del sample['gold']['relevance']
            invalid.write_text(json.dumps(sample, ensure_ascii=False)+'\n', encoding='utf-8')
            r=run('audit',invalid,'--development')
            report=json.loads(r.stdout)
            self.assertNotEqual(r.returncode,0)
            self.assertTrue(any('schema validation failed' in item for item in report['errors']))

    def test_formal_split_refuses_to_invent_missing_samples(self):
        with tempfile.TemporaryDirectory() as td:
            result=run('split',SAMPLE,'--out-dir',Path(td)/'splits','--seed',20260915,'--formal')
            self.assertNotEqual(result.returncode,0)
            self.assertIn('formal split requires 800 samples',result.stderr)

    def test_leakage_audit_detects_cross_split_exact_and_near_duplicates(self):
        with tempfile.TemporaryDirectory() as td:
            td=Path(td)
            rows=SAMPLE.read_text(encoding='utf-8').splitlines()
            train=td/'train.jsonl'; dev=td/'dev.jsonl'; test=td/'test.jsonl'
            train.write_text(rows[0]+'\n',encoding='utf-8')
            duplicate=json.loads(rows[0]); duplicate['sample_id']='CABV1-SYN-003'; duplicate['source_group']='fictional-gamma'
            dev.write_text(json.dumps(duplicate,ensure_ascii=False)+'\n',encoding='utf-8')
            near=json.loads(rows[1]); near['sample_id']='CABV1-SYN-004'; near['source_group']='fictional-delta'; near['raw_input']['ocr_text']=near['raw_input']['ocr_text']+' 请确认。'
            test.write_text(json.dumps(near,ensure_ascii=False)+'\n',encoding='utf-8')
            result=run('leakage','--train',train,'--dev',dev,'--test',test)
            report=json.loads(result.stdout)
            self.assertNotEqual(result.returncode,0)
            self.assertFalse(report['passed'])
            self.assertTrue(report['exact_duplicates'])

    def test_manifest_validator_enforces_formal_counts(self):
        with tempfile.TemporaryDirectory() as td:
            td=Path(td); manifest=td/'manifest.json'
            registry_records=[{
                'sample_id':f'CABV1-MANIFEST-{index:03d}', 'split':'train' if index <= 480 else 'dev' if index <= 640 else 'test', 'data_origin':'reconstructed',
                'document_sha256':'e'*64, 'authorization_status':'AUTHORIZED', 'deidentification_status':'APPROVED',
                'annotation_a_status':'LOCKED', 'annotation_b_status':'LOCKED', 'adjudication_status':'ADJUDICATED',
                'gold_status':'VALIDATED', 'evidence_status':'VALIDATED', 'source_category':'academic',
                'duplicate_family_id':f'duplicate-family-{index}', 'revision_family_id':None, 'external_review_status':'NONE',
            } for index in range(1,801)]
            value={
                'manifest_version':'campus-action-bench-manifest/v1',
                'dataset_id':'CampusActionBench-800','dataset_version':'1.0.0','status':'candidate','total_samples':800,
                'splits':{'train':480,'dev':160,'test':160},
                'files':[{'split':split,'path':f'controlled/{split}.jsonl','sha256':'a'*64,'bytes':1,'record_count':480 if split=='train' else 160,'read_only':True} for split in ('train','dev','test')],
                'sample_registry':{'path':'controlled/sample-registry.jsonl','sha256':'d'*64,'bytes':1,'record_count':800,'records':registry_records},
                'quality':{'authorized':800,'deidentified':800,'annotation_a':800,'annotation_b':800,'adjudicated':800,'gold_validated':800,'evidence_validated':800,'pending_external_review':0},
                'protocols':{'dataset':'campus-action-bench-protocol/v1.0.0','annotation':'campus-action-bench-annotation/v1.0.0','evidence':'campus-action-bench-evidence/v1.0.0','split':'campus-action-bench-split/v1.0.0','evaluator':'campus-action-bench-evaluator/v1.0.0','critical_errors':'campus-action-bench-critical-errors/v1.0.0'},
                'leakage_audit':{'tool':'cab.py','tool_version':'cab/2.0.0','passed':True,'exact_duplicates':0,'near_duplicates':0,'cross_source_groups':0,'reviewer_ids':['p1','p2']},
                'freeze':{'code_commit':'a'*40,'config_sha256':'b'*64,'frozen_at':'2026-09-15T00:00:00Z','manifest_sha256':'c'*64,'reviewer_ids':['p1','p2'],'test_read_only':True},
            }
            manifest.write_text(json.dumps(value),encoding='utf-8')
            self.assertEqual(run('validate-manifest',manifest).returncode,0)
            value['splits']['test']=159; manifest.write_text(json.dumps(value),encoding='utf-8')
            self.assertNotEqual(run('validate-manifest',manifest).returncode,0)

    def test_formal_audit_requires_independent_submissions_and_adjudication_record(self):
        sample=json.loads(SAMPLE.read_text(encoding='utf-8').splitlines()[0])
        sample['provenance']={'source_type':'authorized_reconstructed','authorization_status':'documented','data_origin':'reconstructed'}
        sample['annotation']={'annotator_ids':['ann-a','ann-b'],'adjudication_status':'adjudicated','adjudicator_id':'ann-c'}
        with tempfile.TemporaryDirectory() as td:
            candidate=Path(td)/'candidate.jsonl'; candidate.write_text(json.dumps(sample,ensure_ascii=False)+'\n',encoding='utf-8')
            result=run('audit',candidate,'--expected')
            report=json.loads(result.stdout)
            self.assertNotEqual(result.returncode,0)
            self.assertTrue(any('independent result hashes' in item for item in report['errors']))
            self.assertTrue(any('disagreement report' in item for item in report['errors']))

if __name__=='__main__': unittest.main()
