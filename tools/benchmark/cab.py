#!/usr/bin/env python3
"""Auditable, deterministic CampusActionBench foundation utilities."""
import argparse, hashlib, json, os, re, sys
from collections import Counter, defaultdict
from pathlib import Path
from difflib import SequenceMatcher
from jsonschema import Draft202012Validator, FormatChecker

REQUIRED = ["sample_id","provenance","notice_category","raw_input","user_profile","gold","annotation","data_version","change_history"]
PII = re.compile(r"(?:\b1[3-9]\d{9}\b|\b\d{17}[\dXx]\b|\b\d{10,12}\b|住址|身份证|手机号|学号|真实姓名)")
BENCHMARK_SCHEMA = Path(__file__).resolve().parents[2] / "benchmark" / "schema" / "campus-action-bench-v1.schema.json"
MANIFEST_SCHEMA = Path(__file__).resolve().parents[2] / "benchmark" / "schema" / "campus-action-bench-manifest-v1.schema.json"
CAB_VERSION = "cab/2.0.0"

def load(p):
    rows=[]
    for n,line in enumerate(Path(p).read_text(encoding="utf-8").splitlines(),1):
        if line.strip():
            try: rows.append((n,json.loads(line)))
            except json.JSONDecodeError as e: rows.append((n,{"__parse_error__":str(e)}))
    return rows

def notice_text(x):
    raw_input=x.get("raw_input",{})
    text=raw_input.get("ocr_text","") if isinstance(raw_input,dict) else ""
    return text if isinstance(text,str) else ""

def normalized_notice_text(x):
    return re.sub(r"\s+", "", notice_text(x)).casefold()

def audit(args):
    rows=load(args.input); errors=[]; warnings=[]; ids=[]; groups=defaultdict(list); cats=Counter(); flags=Counter()
    validator=Draft202012Validator(json.loads(BENCHMARK_SCHEMA.read_text(encoding="utf-8")), format_checker=FormatChecker())
    for line,x in rows:
        if "__parse_error__" in x: errors.append(f"line {line}: invalid JSON"); continue
        sample_id=x.get("sample_id")
        sample_key=sample_id if isinstance(sample_id,str) else str(sample_id)
        source_group=x.get("source_group",sample_key)
        source_key=source_group if isinstance(source_group,str) else str(source_group)
        ids.append(sample_key); groups[source_key].append(sample_key)
        category=x.get("notice_category")
        cats[category if isinstance(category,str) else str(category)]+=1
        schema_errors=sorted(validator.iter_errors(x), key=lambda error: list(error.path))
        if schema_errors:
            first=schema_errors[0]
            path="/"+"/".join(str(part) for part in first.path)
            errors.append(f"{x.get('sample_id')}: schema validation failed at {path or '/'}: {first.message}")
        miss=[k for k in REQUIRED if k not in x]
        if miss: errors.append(f"{x.get('sample_id')}: missing {','.join(miss)}")
        prov=x.get("provenance",{})
        if not isinstance(prov,dict): prov={}
        origin=prov.get("data_origin")
        if origin=="synthetic" and prov.get("source_type")!="synthetic_development": errors.append(f"{x.get('sample_id')}: synthetic sample not marked")
        text=notice_text(x)
        if args.expected:
            if origin not in {"real", "reconstructed"}:
                errors.append(f"{x.get('sample_id')}: formal audit requires real or reconstructed data")
            if prov.get("authorization_status")!="documented":
                errors.append(f"{x.get('sample_id')}: formal audit requires documented authorization")
            annotation=x.get("annotation", {})
            if not isinstance(annotation,dict): annotation={}
            annotator_ids=annotation.get("annotator_ids", []) if isinstance(annotation, dict) else []
            if not isinstance(annotator_ids,list): annotator_ids=[]
            annotator_ids=[item for item in annotator_ids if isinstance(item,str)]
            if annotation.get("adjudication_status")!="adjudicated":
                errors.append(f"{x.get('sample_id')}: formal audit requires adjudicated annotation")
            if len(set(annotator_ids)) < 2:
                errors.append(f"{x.get('sample_id')}: formal audit requires two distinct annotators")
            hashes=annotation.get("independent_result_hashes", [])
            if not isinstance(hashes,list) or len(set(item for item in hashes if isinstance(item,str))) < 2:
                errors.append(f"{x.get('sample_id')}: formal audit requires two independent result hashes")
            if not isinstance(annotation.get("adjudicator_id"),str) or annotation.get("adjudicator_id") in annotator_ids:
                errors.append(f"{x.get('sample_id')}: formal audit requires a separate adjudicator")
            if not isinstance(annotation.get("disagreement_report_id"),str):
                errors.append(f"{x.get('sample_id')}: formal audit requires a disagreement report")
            if not isinstance(annotation.get("adjudication_record_id"),str):
                errors.append(f"{x.get('sample_id')}: formal audit requires an adjudication record")
            if not isinstance(x.get("source_group"), str) or not x["source_group"].strip():
                errors.append(f"{x.get('sample_id')}: formal audit requires source_group")
        if PII.search(text) or PII.search(json.dumps(x,ensure_ascii=False)): errors.append(f"{x.get('sample_id')}: possible sensitive information")
        gold=x.get("gold",{})
        if not isinstance(gold,dict): gold={}
        raw=text
        field_evidence=gold.get("field_evidence",[])
        if not isinstance(field_evidence,list): field_evidence=[]
        for ev in field_evidence:
            if not isinstance(ev,dict):
                errors.append(f"{x.get('sample_id')}: invalid evidence span")
                continue
            a,b=ev.get("text_start"),ev.get("text_end")
            if not isinstance(a,int) or not isinstance(b,int) or a<0 or b<a or b>len(raw): errors.append(f"{x.get('sample_id')}: invalid evidence span")
        risk_labels=gold.get("risk_labels",[])
        if not isinstance(risk_labels,list): risk_labels=[]
        risk_tags={tag for tag in risk_labels if isinstance(tag,str)}
        action_graph=gold.get("action_graph",{})
        actions=action_graph.get("actions",[]) if isinstance(action_graph,dict) else []
        for tag in ["multi_action","population_condition","irrelevant_profile","multi_stage","attachment","ambiguity","ocr_review","low_quality_input","change"]:
            if tag in risk_tags or (tag=="multi_action" and isinstance(actions,list) and len(actions)>1): flags[tag]+=1
    dup=[i for i,c in Counter(ids).items() if i and c>1]
    if dup: errors.append("duplicate IDs: "+", ".join(dup))
    total=len([x for _,x in rows if "__parse_error__" not in x]); cats_report={k:{"count":v,"ratio":v/total if total else 0} for k,v in sorted(cats.items())}
    over=[k for k,v in cats_report.items() if v["ratio"]>.25]
    if over:
        message = "category exceeds 25%: "+", ".join(over)
        if args.development:
            warnings.append(message)
        else:
            errors.append(message)
    result={"ok":not errors,"mode":"development" if args.development else "production","total":total,"categories":cats_report,"coverage":{k:{"count":v,"ratio":v/total if total else 0} for k,v in sorted(flags.items())},"duplicate_ids":dup,"lineage_groups":len(groups),"errors":errors,"warnings":warnings}
    if args.compare:
        seen={}
        for cp in args.compare:
            for _,cx in load(cp):
                if "__parse_error__" not in cx:
                    norm=re.sub(r"\s+","",notice_text(cx)).lower()
                    if norm: seen.setdefault(norm,[]).append((cp,cx.get("sample_id")))
        current={re.sub(r"\s+","",notice_text(x)).lower():x.get("sample_id") for _,x in rows if "__parse_error__" not in x}
        exact=[{"sample_id":sid,"other":v} for norm,sid in current.items() if norm in seen for v in seen[norm]]
        near=[]; norms=list(current)
        for i,n in enumerate(norms):
            for m in norms[i+1:]:
                if SequenceMatcher(None,n,m).ratio()>=.92: near.append([current[n],current[m]])
        result["cross_dataset_duplicates"]={"exact":exact,"near":near}
        if exact or near: result["warnings"].append("cross-dataset exact/near duplicate risk detected")
    if args.expected and total!=800: result["errors"].append(f"expected 800 samples, got {total}"); result["ok"]=False
    print(json.dumps(result,ensure_ascii=False,indent=2)); return 0 if result["ok"] else 1

def split(args):
    rows=[x for _,x in load(args.input) if "__parse_error__" not in x]; out=Path(args.out_dir); manifest=out/"test.manifest.json"
    if manifest.exists(): print(f"refusing to overwrite existing freeze manifest: {manifest}",file=sys.stderr); return 2
    if args.formal and len(rows) != 800:
        print(json.dumps({"ok":False,"error":f"formal split requires 800 samples, got {len(rows)}"},ensure_ascii=False),file=sys.stderr)
        return 1
    groups=defaultdict(list)
    for x in rows: groups[x.get("source_group",x["sample_id"])].append(x)
    # deterministic pseudo-shuffle without global randomness
    ordered=sorted(groups.items(),key=lambda kv: hashlib.sha256(f"{args.seed}:{kv[0]}".encode()).hexdigest())
    if args.formal:
        targets=[480,160,160]
        def exact_partition(available, target):
            reachable={0: []}
            for key,items in available:
                size=len(items)
                for current, selected in list(reachable.items()):
                    total=current+size
                    if total <= target and total not in reachable:
                        reachable[total]=selected+[key]
            selected=set(reachable.get(target, []))
            if not selected and target != 0: return None
            chosen=[]; remaining=[]
            for key,items in available:
                (chosen if key in selected else remaining).append((key,items))
            return chosen, remaining
        test_partition=exact_partition(ordered, targets[2])
        if test_partition is None:
            print(json.dumps({"ok":False,"error":"cannot form exact test split without crossing source_group"},ensure_ascii=False),file=sys.stderr)
            return 1
        test_groups, remaining_groups=test_partition
        dev_partition=exact_partition(remaining_groups, targets[1])
        if dev_partition is None:
            print(json.dumps({"ok":False,"error":"cannot form exact dev split without crossing source_group"},ensure_ascii=False),file=sys.stderr)
            return 1
        dev_groups, train_groups=dev_partition
        buckets=[train_groups,dev_groups,test_groups]
        names=["train","dev","test"]
    else:
        targets=[round(len(rows)*.6),round(len(rows)*.2),len(rows)-round(len(rows)*.6)-round(len(rows)*.2)]; buckets=[[],[],[]]
        for _,items in ordered:
            # Deterministic approximate stratification for development samples.
            group_cat=Counter(x.get("notice_category") for x in items)
            def score(j):
                cat_target=targets[j]*(group_cat.most_common(1)[0][1]/len(items)) if items else 0
                cat_have=sum(1 for x in buckets[j] if x.get("notice_category")==group_cat.most_common(1)[0][0]) if items else 0
                return (cat_target-cat_have, targets[j]-len(buckets[j]), -j)
            i=max(range(3),key=score); buckets[i].extend(sorted(items,key=lambda x:x["sample_id"]))
        names=["development","validation","test"]
    out.mkdir(parents=True,exist_ok=True)
    for name,groups_for_split in zip(names,buckets):
        items=[x for _,group in groups_for_split for x in sorted(group,key=lambda x:x["sample_id"])] if args.formal else groups_for_split
        (out/f"{name}.jsonl").write_text("\n".join(json.dumps(x,ensure_ascii=False,sort_keys=True) for x in items)+"\n",encoding="utf-8")
    split_rows=[([x for _,group in groups_for_split for x in group] if args.formal else groups_for_split) for groups_for_split in buckets]
    if args.formal:
        split_rows=[sorted(items,key=lambda x:x["sample_id"]) for items in split_rows]
    counts={name:len(items) for name,items in zip(names,split_rows)}
    (out/"split-manifest.json").write_text(json.dumps({"seed":args.seed,"stratify":args.stratify,"formal":args.formal,"counts":counts,"sample_ids":{n:[x["sample_id"] for x in b] for n,b in zip(names,split_rows)}},ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"counts":counts,"out_dir":str(out),"formal":args.formal},ensure_ascii=False)); return 0

def leakage(args):
    paths={"train":Path(args.train),"dev":Path(args.dev),"test":Path(args.test)}
    rows_by_split={name:[x for _,x in load(path) if "__parse_error__" not in x] for name,path in paths.items()}
    errors=[]; exact=[]; near=[]; cross_groups=[]; ids=defaultdict(list); groups=defaultdict(list); texts=defaultdict(list); hashes=defaultdict(list); relations=[]
    for split_name,rows in rows_by_split.items():
        for row in rows:
            sample_id=row.get("sample_id")
            source_group=row.get("source_group",sample_id)
            ids[str(sample_id)].append(split_name)
            groups[str(source_group)].append((split_name,sample_id))
            normalized=normalized_notice_text(row)
            if normalized: texts[normalized].append((split_name,sample_id))
            raw=row.get("raw_input",{})
            if isinstance(raw,dict):
                for field in ("content_sha256","file_sha256","attachment_sha256"):
                    value=raw.get(field)
                    if isinstance(value,str) and value: hashes[value].append((split_name,sample_id))
            for field in ("revision_of","parent_sample_id","revokes_sample_id","supersedes_sample_id"):
                value=row.get(field)
                if isinstance(value,str) and value: relations.append((split_name,sample_id,value))
    for sample_id,split_names in ids.items():
        if len(split_names)>1: errors.append(f"duplicate sample_id across rows: {sample_id}")
    for source_group,entries in groups.items():
        split_names={split for split,_ in entries}
        if len(split_names)>1:
            cross_groups.append({"source_group":source_group,"entries":entries}); errors.append(f"source_group crosses split: {source_group}")
    def cross_entries(index, label):
        for key,entries in index.items():
            split_names={split for split,_ in entries}
            if len(entries)>1:
                exact.append({label:key,"entries":entries}); errors.append(f"{label} crosses split: {key}")
    cross_entries(texts,"normalized_text")
    cross_entries(hashes,"content_hash")
    by_split_text={split:[] for split in paths}
    for split_name,rows in rows_by_split.items():
        for row in rows:
            normalized=normalized_notice_text(row)
            if normalized: by_split_text[split_name].append((normalized,row.get("sample_id")))
    for left_index,left_name in enumerate(paths):
        for right_name in list(paths)[left_index+1:]:
            for left_text,left_id in by_split_text[left_name]:
                for right_text,right_id in by_split_text[right_name]:
                    ratio=SequenceMatcher(None,left_text,right_text).ratio()
                    if ratio>=args.threshold and left_text!=right_text:
                        near.append({"left":{"split":left_name,"sample_id":left_id},"right":{"split":right_name,"sample_id":right_id},"ratio":round(ratio,6)})
    all_ids={str(row.get("sample_id")):split for split,rows in rows_by_split.items() for row in rows}
    for split_name,sample_id,target in relations:
        if target in all_ids and all_ids[target]!=split_name:
            errors.append(f"revision relationship crosses split: {sample_id}->{target}")
    if near: errors.append(f"near duplicate candidates across split: {len(near)}")
    result={"tool":"cab.py","tool_version":CAB_VERSION,"passed":not errors,"threshold":args.threshold,"row_counts":{name:len(rows) for name,rows in rows_by_split.items()},"exact_duplicates":exact,"near_duplicates":near,"cross_source_groups":cross_groups,"errors":errors}
    print(json.dumps(result,ensure_ascii=False,indent=2)); return 0 if not errors else 1

def validate_manifest(args):
    value=json.loads(Path(args.input).read_text(encoding="utf-8"))
    validator=Draft202012Validator(json.loads(MANIFEST_SCHEMA.read_text(encoding="utf-8")), format_checker=FormatChecker())
    errors=[]
    for error in sorted(validator.iter_errors(value),key=lambda item:list(item.path)):
        path="/"+"/".join(str(part) for part in error.path)
        errors.append(f"{path or '/'}: {error.message}")
    if not errors:
        expected={"train":480,"dev":160,"test":160}
        actual={item["split"]:item["record_count"] for item in value["files"]}
        if set(actual) != set(expected): errors.append("/files: must contain exactly train, dev, and test entries")
        for split,count in expected.items():
            if actual.get(split)!=count: errors.append(f"/files: {split} record_count must be {count}")
    result={"tool":"cab.py","tool_version":CAB_VERSION,"ok":not errors,"errors":errors}
    print(json.dumps(result,ensure_ascii=False,indent=2)); return 0 if not errors else 1

def digest(p):
    h=hashlib.sha256(); h.update(Path(p).read_bytes()); return h.hexdigest()
def freeze(args):
    out=Path(args.manifest)
    if out.exists(): print(f"refusing to overwrite manifest: {out}",file=sys.stderr); return 2
    files=[]
    for p in [Path(args.test),Path(args.config),Path(args.version)]: files.append({"path":str(p),"sha256":digest(p),"bytes":p.stat().st_size})
    data={"algorithm":"SHA-256","test_order_sha256":hashlib.sha256(Path(args.test).read_bytes()).hexdigest(),"files":files,"tool":"cab.py"}
    out.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf-8"); print(json.dumps(data,ensure_ascii=False,indent=2)); return 0
def verify(args):
    m=json.loads(Path(args.manifest).read_text(encoding="utf-8")); bad=[]
    for f in m["files"]:
        if not Path(f["path"]).exists() or digest(f["path"])!=f["sha256"]: bad.append(f["path"])
    if digest(args.test)!=m["test_order_sha256"]: bad.append(args.test)
    print(json.dumps({"ok":not bad,"mismatches":bad},ensure_ascii=False)); return 0 if not bad else 1
def main():
    p=argparse.ArgumentParser(); s=p.add_subparsers(dest="cmd",required=True)
    a=s.add_parser("audit"); a.add_argument("input"); a.add_argument("--expected",action="store_true"); a.add_argument("--development",action="store_true"); a.add_argument("--compare",action="append",default=[]); a.set_defaults(fn=audit)
    d=s.add_parser("split"); d.add_argument("input"); d.add_argument("--out-dir",required=True); d.add_argument("--seed",type=int,required=True); d.add_argument("--stratify",default="notice_category"); d.add_argument("--formal",action="store_true"); d.set_defaults(fn=split)
    l=s.add_parser("leakage"); l.add_argument("--train",required=True); l.add_argument("--dev",required=True); l.add_argument("--test",required=True); l.add_argument("--threshold",type=float,default=.92); l.set_defaults(fn=leakage)
    m=s.add_parser("validate-manifest"); m.add_argument("input"); m.set_defaults(fn=validate_manifest)
    f=s.add_parser("freeze"); f.add_argument("test"); f.add_argument("config"); f.add_argument("version"); f.add_argument("--manifest",required=True); f.set_defaults(fn=freeze)
    v=s.add_parser("verify"); v.add_argument("manifest"); v.add_argument("test"); v.set_defaults(fn=verify)
    ns=p.parse_args(); return ns.fn(ns)
if __name__=="__main__": sys.exit(main())
