#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import time
from pathlib import Path


def utc() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def read_complete_event(log_path: Path) -> dict | None:
    if not log_path.exists():
        return None
    complete: dict | None = None
    with log_path.open(encoding="utf-8", errors="replace") as handle:
        for line in handle:
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event.get("event") == "complete":
                complete = event
    return complete


def read_ready_metadata(batch_dir: Path) -> dict:
    ready = batch_dir / ".ready"
    if not ready.exists():
        return {}
    try:
        return json.loads(ready.read_text(encoding="utf-8", errors="replace").splitlines()[0])
    except Exception:
        return {}


def safe_remove_batch(base: Path, batch_dir: Path) -> None:
    resolved_base = base.resolve()
    resolved_batch = batch_dir.resolve()
    if resolved_batch == resolved_base or not str(resolved_batch).startswith(str(resolved_base) + os.sep):
        raise RuntimeError(f"refusing cleanup outside ingest base: {batch_dir}")
    if batch_dir.exists():
        shutil.rmtree(batch_dir)


def main() -> int:
    parser = argparse.ArgumentParser(description="Finalize a manually resumed external GBrain batch.")
    parser.add_argument("--base", default="/srv/gbrain/inbox/external-ingest-20260627")
    parser.add_argument("--batch", required=True)
    parser.add_argument("--log", required=True)
    parser.add_argument("--method", default="resilient-native-import-20260630")
    parser.add_argument("--wait", action="store_true")
    parser.add_argument("--poll", type=int, default=20)
    parser.add_argument("--timeout", type=int, default=7200)
    parser.add_argument("--start-service", default="")
    args = parser.parse_args()

    base = Path(args.base)
    batch_dir = base / args.batch
    pages_dir = base / "pages-all" / args.batch
    completed_dir = base / ".completed"
    completed_marker = completed_dir / f"{args.batch}.json"
    log_path = Path(args.log)

    deadline = time.time() + args.timeout
    complete = read_complete_event(log_path)
    while args.wait and complete is None and time.time() < deadline:
        time.sleep(args.poll)
        complete = read_complete_event(log_path)
    if complete is None:
        print(json.dumps({"event": "finalize-skip-not-complete", "batch": args.batch, "log": str(log_path)}, ensure_ascii=False))
        return 1

    failures = int(complete.get("failures") or 0)
    if failures:
        print(json.dumps({"event": "finalize-skip-failures", "batch": args.batch, "failures": failures}, ensure_ascii=False))
        return 2

    page_count = sum(1 for _ in pages_dir.glob("*.md")) if pages_dir.exists() else 0
    metadata = read_ready_metadata(batch_dir)
    completed_dir.mkdir(parents=True, exist_ok=True)
    if batch_dir.exists():
        (batch_dir / ".import-done").write_text(json.dumps({"done_at": utc()}, ensure_ascii=False) + "\n", encoding="utf-8")

    payload = {
        "batch": args.batch,
        "completed_at": utc(),
        "import_method": args.method,
        "source": metadata.get("source", ""),
        "source_host": metadata.get("source_host", ""),
        "note": metadata.get("note", ""),
        "pages": str(pages_dir),
        "page_count": page_count,
        "staging_path_removed": True,
        "resilient_log": str(log_path),
    }
    completed_marker.write_text(json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    safe_remove_batch(base, batch_dir)

    if args.start_service:
        subprocess.run(["systemctl", "--user", "start", args.start_service], check=False)

    print(json.dumps({"event": "finalize-done", **payload}, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
