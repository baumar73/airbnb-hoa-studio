#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import time
from collections import deque
from pathlib import Path


def utc() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def emit(log_path: Path, event: str, **data) -> None:
    row = {"ts": utc(), "event": event, **data}
    line = json.dumps(row, ensure_ascii=False, sort_keys=True)
    print(line, flush=True)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")


def load_checkpoint(path: Path, source_dir: Path) -> set[str]:
    if not path.exists():
        return set()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return set()
    if Path(str(payload.get("dir") or "")) != source_dir:
        return set()
    values = payload.get("completedPaths") or []
    return {str(value) for value in values if isinstance(value, str)}


def load_done(path: Path) -> set[str]:
    done: set[str] = set()
    if not path.exists():
        return done
    with path.open(encoding="utf-8", errors="replace") as handle:
        for line in handle:
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if row.get("event") == "chunk-done":
                done.update(str(item) for item in row.get("files", []) if isinstance(item, str))
            elif row.get("event") == "single-failed":
                # A single failed file was intentionally isolated and should
                # not block the rest of the import on script restart.
                rel = row.get("file")
                if isinstance(rel, str):
                    done.add(rel)
    return done


def safe_name(index: int) -> str:
    return f"chunk-{index:06d}"


def prepare_chunk(chunk_dir: Path, source_dir: Path, rel_files: list[str]) -> None:
    if chunk_dir.exists():
        shutil.rmtree(chunk_dir)
    chunk_dir.mkdir(parents=True, exist_ok=True)
    seen_names: set[str] = set()
    for rel in rel_files:
        src = (source_dir / rel).resolve()
        if not src.is_file():
            continue
        # The source pages directory is flat today. Keep a collision guard so a
        # future nested tree does not silently alter slug identity.
        target_name = Path(rel).name
        if target_name in seen_names:
            raise RuntimeError(f"filename collision in chunk: {target_name}")
        seen_names.add(target_name)
        target = chunk_dir / target_name
        try:
            os.link(src, target)
        except OSError:
            shutil.copy2(src, target)


def run_import(chunk_dir: Path, output_log: Path, timeout_seconds: int) -> int:
    env = os.environ.copy()
    env["PATH"] = f"{Path.home() / '.bun' / 'bin'}:{env.get('PATH', '')}"
    env["GBRAIN_SKIP_STARTUP_HOOKS"] = "1"
    cmd = [
        "timeout",
        "-k",
        "30s",
        str(timeout_seconds),
        "/usr/local/bin/gbrain",
        "import",
        str(chunk_dir),
        "--no-embed",
        "--workers",
        "1",
        "--fresh",
        "--json",
    ]
    with output_log.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({"ts": utc(), "event": "command", "cmd": cmd}, ensure_ascii=False) + "\n")
        handle.flush()
        result = subprocess.run(cmd, stdout=handle, stderr=subprocess.STDOUT, text=True, env=env, check=False)
    return result.returncode


def main() -> int:
    parser = argparse.ArgumentParser(description="Resume a large gbrain markdown import in timeout-bounded chunks.")
    parser.add_argument("--source-dir", required=True)
    parser.add_argument("--work-dir", required=True)
    parser.add_argument("--log", required=True)
    parser.add_argument("--checkpoint", default=str(Path.home() / ".gbrain" / "import-checkpoint.json"))
    parser.add_argument("--chunk-size", type=int, default=200)
    parser.add_argument("--timeout", type=int, default=300)
    parser.add_argument("--max-failures", type=int, default=200)
    args = parser.parse_args()

    source_dir = Path(args.source_dir).resolve()
    work_dir = Path(args.work_dir).resolve()
    event_log = Path(args.log).resolve()
    import_log = event_log.with_suffix(".gbrain.log")
    done_log = event_log.with_suffix(".done.jsonl")
    failed_log = event_log.with_suffix(".failed.jsonl")

    if not source_dir.is_dir():
        raise SystemExit(f"source dir not found: {source_dir}")
    if args.chunk_size < 1:
        raise SystemExit("--chunk-size must be >= 1")

    work_dir.mkdir(parents=True, exist_ok=True)
    chunks_root = work_dir / "chunks"
    chunks_root.mkdir(parents=True, exist_ok=True)

    all_files = sorted((str(path.relative_to(source_dir)) for path in source_dir.rglob("*.md")), reverse=True)
    checkpoint_done = load_checkpoint(Path(args.checkpoint), source_dir)
    local_done = load_done(done_log)
    skip = checkpoint_done | local_done
    remaining = [rel for rel in all_files if rel not in skip]

    emit(
        event_log,
        "start",
        source_dir=str(source_dir),
        total=len(all_files),
        checkpoint_done=len(checkpoint_done),
        local_done=len(local_done),
        remaining=len(remaining),
        chunk_size=args.chunk_size,
        timeout=args.timeout,
    )

    queue: deque[list[str]] = deque(
        remaining[index:index + args.chunk_size]
        for index in range(0, len(remaining), args.chunk_size)
    )
    failures = 0
    completed = 0
    chunk_index = 0

    while queue:
        rel_files = queue.popleft()
        rel_files = [rel for rel in rel_files if rel not in load_done(done_log)]
        if not rel_files:
            continue
        chunk_index += 1
        chunk_name = safe_name(chunk_index)
        chunk_dir = chunks_root / chunk_name
        emit(event_log, "chunk-start", chunk=chunk_name, files=len(rel_files), first=rel_files[0], last=rel_files[-1])
        prepare_chunk(chunk_dir, source_dir, rel_files)
        rc = run_import(chunk_dir, import_log, args.timeout)
        if rc == 0:
            completed += len(rel_files)
            with done_log.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps({"ts": utc(), "event": "chunk-done", "chunk": chunk_name, "files": rel_files}, ensure_ascii=False) + "\n")
            emit(event_log, "chunk-done", chunk=chunk_name, files=len(rel_files), completed=completed, queued=len(queue))
            shutil.rmtree(chunk_dir, ignore_errors=True)
            continue

        emit(event_log, "chunk-failed", chunk=chunk_name, files=len(rel_files), returncode=rc)
        if len(rel_files) > 1:
            mid = len(rel_files) // 2
            queue.appendleft(rel_files[mid:])
            queue.appendleft(rel_files[:mid])
            shutil.rmtree(chunk_dir, ignore_errors=True)
            continue

        failures += 1
        failed_payload = {"ts": utc(), "event": "single-failed", "file": rel_files[0], "returncode": rc}
        with failed_log.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(failed_payload, ensure_ascii=False, sort_keys=True) + "\n")
        with done_log.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps({"ts": utc(), "event": "single-failed", "file": rel_files[0]}, ensure_ascii=False, sort_keys=True) + "\n")
        emit(event_log, "single-failed", file=rel_files[0], returncode=rc, failures=failures)
        if failures >= args.max_failures:
            emit(event_log, "abort-too-many-failures", failures=failures)
            return 2

    emit(event_log, "complete", completed=completed, failures=failures)
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
