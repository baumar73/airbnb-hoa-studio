#!/usr/bin/env python3
"""Export and sync Airbnb HOA knowledge pages into remote GBrain."""

from __future__ import annotations

import argparse
import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
PACKAGE_DIR = ROOT / "gbrain-import" / "airbnb-hoa-operations"
REMOTE_HOST = os.environ.get("AIRBNB_HOA_GBRAIN_HOST", "").strip()
REMOTE_BASE = os.environ.get("AIRBNB_HOA_GBRAIN_REMOTE_BASE", "").strip()
REMOTE_CWD = os.environ.get("AIRBNB_HOA_GBRAIN_REMOTE_CWD", "").strip()

sys.path.insert(0, str(ROOT / "tools"))
import gbrain_export  # noqa: E402


def run(command: list[str], timeout: int = 120) -> dict[str, Any]:
    try:
        completed = subprocess.run(
            command,
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
        )
        return {
            "ok": completed.returncode == 0,
            "returncode": completed.returncode,
            "stdout": completed.stdout.strip(),
            "stderr": completed.stderr.strip(),
            "command": command,
        }
    except subprocess.TimeoutExpired as exc:
        stdout = exc.stdout.strip() if isinstance(exc.stdout, str) else ""
        stderr = exc.stderr.strip() if isinstance(exc.stderr, str) else ""
        return {
            "ok": False,
            "returncode": None,
            "stdout": stdout,
            "stderr": stderr or f"timeout after {timeout}s",
            "command": command,
        }


def require_ok(result: dict[str, Any], label: str) -> None:
    if result["ok"]:
        return
    detail = result.get("stderr") or result.get("stdout") or f"return code {result.get('returncode')}"
    raise RuntimeError(f"{label} failed: {detail}")


def make_archive(source_dir: Path) -> Path:
    tmpdir = Path(tempfile.mkdtemp(prefix="airbnb-hoa-gbrain-"))
    archive_base = tmpdir / "airbnb-hoa-gbrain-import"
    archive = Path(shutil.make_archive(str(archive_base), "gztar", root_dir=source_dir))
    return archive


def make_import_staging() -> Path:
    staging = Path(tempfile.mkdtemp(prefix="airbnb-hoa-gbrain-staging-"))
    for page in PACKAGE_DIR.glob("*.md"):
        if page.name.lower() == "readme.md":
            continue
        shutil.copy2(page, staging / page.name)
    generated_dir = PACKAGE_DIR / "generated"
    if generated_dir.exists():
        for page in generated_dir.glob("*.md"):
            shutil.copy2(page, staging / page.name)
    return staging


def missing_remote_config() -> list[str]:
    return [
        name for name, value in (
            ("AIRBNB_HOA_GBRAIN_HOST", REMOTE_HOST),
            ("AIRBNB_HOA_GBRAIN_REMOTE_BASE", REMOTE_BASE),
            ("AIRBNB_HOA_GBRAIN_REMOTE_CWD", REMOTE_CWD),
        ) if not value
    ]


def sync_remote(archive: Path) -> dict[str, Any]:
    missing_config = missing_remote_config()
    if missing_config:
        return {"configured": False, "status": "disabled", "missing": missing_config, "steps": []}
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    remote_dir = f"{REMOTE_BASE}-{stamp}"
    remote_archive = f"{REMOTE_BASE}-archive-{stamp}.tgz"

    steps: list[dict[str, Any]] = []
    steps.append(run(["scp", "-q", str(archive), f"{REMOTE_HOST}:{remote_archive}"], timeout=60))
    require_ok(steps[-1], "scp")

    unpack = (
        f"set -e\n"
        f"rm -rf {remote_dir!r}\n"
        f"mkdir -p {remote_dir!r}\n"
        f"tar -C {remote_dir!r} -xzf {remote_archive!r}\n"
        f"find {remote_dir!r} -maxdepth 3 -type f -name '*.md' | wc -l\n"
    )
    steps.append(run(["ssh", REMOTE_HOST, unpack], timeout=60))
    require_ok(steps[-1], "remote unpack")

    put_script = f"""
import json
import pathlib
import subprocess
import sys

root = pathlib.Path({remote_dir!r})
results = []
errors = []
for path in sorted(root.glob("*.md")):
    slug = path.stem.replace("-", "/", 1)
    flat_slug = path.stem
    content = path.read_text(encoding="utf-8")
    put = subprocess.run(["gbrain", "put", slug, "--content", content], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    item = {{"file": path.name, "slug": slug, "ok": put.returncode == 0, "stdout": put.stdout.strip()[-800:], "stderr": put.stderr.strip()[-800:]}}
    results.append(item)
    if put.returncode != 0:
        errors.append(item)
        continue
    if flat_slug != slug:
        subprocess.run(["gbrain", "delete", flat_slug], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
print(json.dumps({{"count": len(results), "errors": errors, "results": results}}, ensure_ascii=False))
sys.exit(1 if errors else 0)
""".strip()
    put_cmd = f"cd {shlex.quote(REMOTE_CWD)} && python3 - <<'PY'\n{put_script}\nPY"
    steps.append(run(["ssh", REMOTE_HOST, put_cmd], timeout=240))
    require_ok(steps[-1], "gbrain exact put")

    embed_cmd = f"cd {shlex.quote(REMOTE_CWD)} && gbrain embed --stale"
    steps.append(run(["ssh", REMOTE_HOST, embed_cmd], timeout=240))
    require_ok(steps[-1], "gbrain embed")

    verify_cmd = "gbrain query 'Airbnb HOA Unit 405D Board Approval GBrain sync' | sed -n '1,80p'"
    steps.append(run(["ssh", REMOTE_HOST, verify_cmd], timeout=60))
    require_ok(steps[-1], "gbrain verify query")

    return {
        "remoteDir": remote_dir,
        "remoteArchive": remote_archive,
        "steps": [
            {
                "ok": step["ok"],
                "returncode": step["returncode"],
                "stdout": step["stdout"][:2000],
                "stderr": step["stderr"][:2000],
            }
            for step in steps
        ],
        "verificationPreview": steps[-1]["stdout"][:2000],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync Airbnb HOA safe knowledge pages to GBrain")
    parser.add_argument("--today", default=None, help="Override date as YYYY-MM-DD")
    parser.add_argument("--export-only", action="store_true", help="Generate pages but do not import into remote GBrain")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    today_value = gbrain_export.parse_day(args.today) if args.today else gbrain_export.today_panama()
    if not today_value:
        raise SystemExit("Invalid --today")

    missing_config = missing_remote_config()
    if not args.export_only and missing_config:
        result = {
            "ok": False,
            "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "manifest": None,
            "remote": {"configured": False, "status": "disabled", "missing": missing_config, "steps": []},
        }
        if args.json:
            print(json.dumps(result, indent=2, ensure_ascii=False))
        else:
            print(f"Remote GBrain sync disabled; configure {', '.join(missing_config)}.")
        return 0

    manifest = gbrain_export.export_pages(today_value=today_value)
    result: dict[str, Any] = {
        "ok": True,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "manifest": manifest,
        "remote": None,
    }

    if not args.export_only:
        staging = make_import_staging()
        result["stagingDir"] = str(staging)
        archive = make_archive(staging)
        result["archive"] = str(archive)
        result["remote"] = sync_remote(archive)

    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(f"Generated {len(manifest['pages'])} safe GBrain pages.")
        if args.export_only:
            print("Export only; remote GBrain import skipped.")
        else:
            print(f"Imported into remote GBrain at {result['remote']['remoteDir']}.")
            print(result["remote"]["verificationPreview"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
