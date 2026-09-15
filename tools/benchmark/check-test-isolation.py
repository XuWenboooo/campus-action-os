#!/usr/bin/env python3
"""Fail closed when sealed test sample IDs enter a training workflow path."""
import argparse
import json
import sys
from pathlib import Path


def load_ids(path: Path):
    return sorted({line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()})


def files_under(path: Path):
    if path.is_file():
        yield path
        return
    yield from (item for item in path.rglob("*") if item.is_file())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--test-ids", required=True, type=Path)
    parser.add_argument("--scan", required=True, nargs="+", type=Path)
    args = parser.parse_args()
    errors = []
    if not args.test_ids.is_file():
        errors.append(f"test ID file does not exist: {args.test_ids}")
        test_ids = []
    else:
        test_ids = load_ids(args.test_ids)
        if not test_ids:
            errors.append("test ID file is empty; refusing to pass isolation check")
    scan_files = []
    for root in args.scan:
        if not root.exists():
            errors.append(f"scan path does not exist: {root}")
            continue
        scan_files.extend(files_under(root))
    matches = []
    encoded_ids = [(sample_id, sample_id.encode("utf-8")) for sample_id in test_ids]
    for path in sorted(set(scan_files)):
        try:
            payload = path.read_bytes()
        except OSError as error:
            errors.append(f"cannot read scan path: {path}: {error}")
            continue
        for sample_id, encoded in encoded_ids:
            if encoded in payload:
                matches.append({"path": str(path), "sample_id": sample_id})
    if matches:
        errors.append(f"sealed test IDs found in training workflow paths: {len(matches)}")
    result = {
        "checker": "phase3-test-isolation",
        "version": "1.0.0",
        "passed": not errors,
        "scanned_files": len(set(scan_files)),
        "matches": matches,
        "errors": errors,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
