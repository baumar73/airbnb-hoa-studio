#!/usr/bin/env python3
"""Synthetic end-to-end smoke test for the OpenAI HOA reviewer."""
import base64
import importlib.util
import io
import json
import os
import pathlib
import subprocess
import tempfile
import time
import fitz
from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parents[1]

with tempfile.TemporaryDirectory(prefix="isla-openai-smoke-") as directory:
    temp = pathlib.Path(directory)
    image = Image.new("RGB", (640, 170), "white")
    ImageDraw.Draw(image).line((30, 110, 150, 60, 300, 120, 570, 70), fill="black", width=6)
    buffer = io.BytesIO()
    image.save(buffer, "PNG")
    signature = base64.b64encode(buffer.getvalue()).decode()
    adult = {
        "firstName": "Test", "middleName": "Example", "lastName": "Guest",
        "phone": "+1-555-000-005", "email": "test@example.com", "street": "1 Main Street",
        "city": "St Petersburg", "state": "FL", "zip": "33715", "sigPng": signature,
        "esignConsent": True,
    }
    case = {
        "id": "synthetic", "guestName": "Test Example Guest", "reservationCode": "TEST123",
        "checkIn": "2026-10-17", "checkOut": "2026-12-20", "nights": 64, "adults": 1,
        "pathType": "full", "reviewHash": "synthetic",
        "wizard": {
            "adults": [adult],
            "children": [], "esignConsent": True, "rulesAcknowledged": True,
        },
    }
    (temp / "case.json").write_text(json.dumps(case))
    (temp / "signature.txt").write_text(signature)
    forms = temp / "forms"
    forms.mkdir()
    rules = fitz.open()
    page = rules.new_page(width=612, height=792)
    page.insert_text((72, 72), "Synthetic Rules and Regulations template for smoke verification")
    rules.save(forms / "rules-and-regulations.pdf")
    rules.close()
    generated = subprocess.run([
        "node", str(ROOT / "scripts/generate_review_bundle.mjs"), str(temp / "case.json"),
        str(temp / "signature.txt"), str(temp / "bundle"),
    ], cwd=ROOT, text=True, capture_output=True, env={**os.environ, "ISLA_FORMS_ROOT": str(forms)})
    if generated.returncode:
        raise RuntimeError(generated.stderr or generated.stdout)
    bundle_result = json.loads(generated.stdout)
    pdf_paths = sorted((temp / "bundle").glob("*.pdf"))
    if len(pdf_paths) != 2 or not all(path.name in {"01-rules-and-acknowledgment.pdf", "02-short-term-lease.pdf"} for path in pdf_paths):
        raise RuntimeError("smoke generator did not emit exactly the two safe coordination PDFs")
    if not isinstance(bundle_result.get("bundleDigest"), str) or len(bundle_result["bundleDigest"]) != 64:
        raise RuntimeError("smoke generator did not return a bundle digest")
    spec = importlib.util.spec_from_file_location("reviewer", ROOT / "scripts/run_local_ai_review.py")
    reviewer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(reviewer)
    started = time.time()
    report = reviewer.local_ai_review(case, pdf_paths)
    report["bundleDigest"] = bundle_result["bundleDigest"]
    result = {
        "model": reviewer.MODEL,
        "seconds": round(time.time() - started, 1),
        "pdfs": len(pdf_paths),
        "bundleDigest": report["bundleDigest"],
        "status": report["status"],
        "confidence": report["confidence"],
        "summary": report["summary"],
        "findings": report["findings"],
        "documents": report["documents"],
    }
    print(json.dumps(result, ensure_ascii=False))
    if report["status"] != "green" or report["findings"]:
        raise SystemExit(1)
