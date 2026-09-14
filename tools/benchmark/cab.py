#!/usr/bin/env python3
"""Auditable, deterministic CampusActionBench foundation utilities."""
import argparse, hashlib, json, os, re, sys
from collections import Counter, defaultdict
from pathlib import Path
from difflib import SequenceMatcher

REQUIRED = ["sample_id","provenance","notice_category","raw_input","user_profile","gold","annotation","data_version","change_history"]
PII = re.compile(r"(?:\b1[3-9]\d{9}\b|\b\d{17}[\dXx]\b|\b\d{10,12}\b|住址|身份证|手机号|学号|真实姓名)")

def load(p):
    rows=[]
    for n,line in enumerate(Path(p).read_text(encoding="utf-8").splitlines(),1):
        if line.strip():
            try: rows.append((n,json.loads(line)))
            except json.JSONDecodeError as e: rows.append((n,{"__parse_error__":str(e)}))
    return rows

def audit(args):
    rows=load(args.input); errors=[]; warnings=[]; ids=[]; groups=defaultdict(list); cats=Counter(); flags=Counter()
    for line,x in rows:
        if "__parse_error__" in x: errors.append(f"line {line}: invalid JSON"); continue
        ids.append(x.get("sample_id")); groups[x.get("source_group",x.get("sample_id"))].append(x.get("sample_id")); cats[x.get("notice_category")]+=1
        miss=[k for k in REQUIRED if k not in x]
        if miss: errors.append(f"{x.get('sample_id')}: missing {','.join(miss)}")
        prov=x.get("provenance",{}); origin=prov.get("data_origin")
        if origin=="synthetic" and prov.get("source_type")!="synthetic_development": errors.append(f"{x.get('sample_id')}: synthetic sample not marked")
        text=x.get("raw_input",{}).get("ocr_text","")
        if PII.search(text) or PII.search(json.dumps(x,ensure_ascii=False)): errors.append(f"{x.get('sample_id')}: possible sensitive information")
        gold=x.get("gold",{}); raw=text
        for ev in gold.get("field_evidence",[]):
            a,b=ev.get("text_start"),ev.get("text_end")
            if not isinstance(a,int) or not isinstance(b,int) or a<0 or b<a or b>len(raw): errors.append(f"{x.get('sample_id')}: invalid evidence span")
        for tag in ["multi_action","population_condition","irrelevant_profile","multi_stage","attachment","ambiguity","ocr_review","low_quality_input","change"]:
            if tag in set(gold.get("risk_labels",[])) or (tag=="multi_action" and len(gold.get("action_graph",{}).get("actions",[]))>1): flags[tag]+=1
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
                    norm=re.sub(r"\s+","",cx.get("raw_input",{}).get("ocr_text","")).lower()
                    if norm: seen.setdefault(norm,[]).append((cp,cx.get("sample_id")))
        current={re.sub(r"\s+","",x.get("raw_input",{}).get("ocr_text","")).lower():x.get("sample_id") for _,x in rows if "__parse_error__" not in x}
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
    groups=defaultdict(list)
    for x in rows: groups[x.get("source_group",x["sample_id"])].append(x)
    # deterministic pseudo-shuffle without global randomness
    ordered=sorted(groups.items(),key=lambda kv: hashlib.sha256(f"{args.seed}:{kv[0]}".encode()).hexdigest())
    targets=[round(len(rows)*.6),round(len(rows)*.2),len(rows)-round(len(rows)*.6)-round(len(rows)*.2)]; buckets=[[],[],[]]
    for _,items in ordered:
        # Deterministic approximate stratification: choose the bucket with the
        # largest deficit for this group's category, then global target deficit.
        cat=Counter(x.get("notice_category") for x in rows); group_cat=Counter(x.get("notice_category") for x in items)
        def score(j):
            cat_target=targets[j]*(group_cat.most_common(1)[0][1]/len(items)) if items else 0
            cat_have=sum(1 for x in buckets[j] if x.get("notice_category")==group_cat.most_common(1)[0][0]) if items else 0
            return (cat_target-cat_have, targets[j]-len(buckets[j]), -j)
        i=max(range(3),key=score); buckets[i].extend(sorted(items,key=lambda x:x["sample_id"]))
    out.mkdir(parents=True,exist_ok=True)
    names=["development","validation","test"]
    for name,b in zip(names,buckets): (out/f"{name}.jsonl").write_text("\n".join(json.dumps(x,ensure_ascii=False,sort_keys=True) for x in b)+"\n",encoding="utf-8")
    (out/"split-manifest.json").write_text(json.dumps({"seed":args.seed,"stratify":args.stratify,"counts":dict(zip(names,map(len,buckets))),"sample_ids":{n:[x["sample_id"] for x in b] for n,b in zip(names,buckets)}},ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"counts":dict(zip(names,map(len,buckets))),"out_dir":str(out)},ensure_ascii=False)); return 0

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
    d=s.add_parser("split"); d.add_argument("input"); d.add_argument("--out-dir",required=True); d.add_argument("--seed",type=int,required=True); d.add_argument("--stratify",default="notice_category"); d.set_defaults(fn=split)
    f=s.add_parser("freeze"); f.add_argument("test"); f.add_argument("config"); f.add_argument("version"); f.add_argument("--manifest",required=True); f.set_defaults(fn=freeze)
    v=s.add_parser("verify"); v.add_argument("manifest"); v.add_argument("test"); v.set_defaults(fn=verify)
    ns=p.parse_args(); return ns.fn(ns)
if __name__=="__main__": sys.exit(main())
