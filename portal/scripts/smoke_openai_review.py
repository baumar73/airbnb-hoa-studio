#!/usr/bin/env python3
"""Synthetic end-to-end smoke test for the OpenAI HOA reviewer."""
import base64
import importlib.util
import io
import json
import pathlib
import subprocess
import tempfile
import time
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
        "firstName": "Test", "middleName": "Example", "lastName": "Guest", "birthDate": "1980-01-01", "gender": "F",
        "phone": "+1-555-000-005", "email": "test@example.com", "street": "1 Main Street",
        "city": "St Petersburg", "state": "FL", "zip": "33715", "idType": "drivers_license", "idNumber": "TEST123",
        "idState": "FL", "employer": "Retired", "employerPhone": "N/A", "sigPng": signature,
        "esignConsent": True,
    }
    case = {
        "id": "synthetic", "guestName": "Test Guest", "reservationCode": "TEST123",
        "checkIn": "2026-10-17", "checkOut": "2026-12-20", "nights": 64, "adults": 1,
        "pathType": "full", "reviewHash": "synthetic",
        "wizard": {
            "adults": [adult],
            "references": [
                {"name": "Reference One", "phone": "+1-555-000-001", "address": "1 Ref Street, Tampa FL"},
                {"name": "Reference Two", "phone": "+1-555-000-002", "address": "2 Ref Street, Tampa FL"},
            ],
            "emergency": [
                {"name": "Emergency One", "phone": "+1-555-000-003"},
                {"name": "Emergency Two", "phone": "+1-555-000-004"},
            ],
            "children": [], "esignConsent": True, "rulesAcknowledged": True,
        },
    }
    (temp / "case.json").write_text(json.dumps(case))
    (temp / "signature.txt").write_text(signature)
    generated = subprocess.run([
        "node", str(ROOT / "scripts/generate_review_bundle.mjs"), str(temp / "case.json"),
        str(temp / "signature.txt"), str(temp / "bundle"),
    ], cwd=ROOT, text=True, capture_output=True)
    if generated.returncode:
        raise RuntimeError(generated.stderr)
    spec = importlib.util.spec_from_file_location("reviewer", ROOT / "scripts/run_local_ai_review.py")
    reviewer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(reviewer)
    started = time.time()
    report = reviewer.local_ai_review(case, sorted((temp / "bundle").glob("*.pdf")))
    print(json.dumps({
        "model": reviewer.MODEL,
        "seconds": round(time.time() - started, 1),
        "pdfs": len(list((temp / "bundle").glob("*.pdf"))),
        "status": report["status"],
        "confidence": report["confidence"],
        "summary": report["summary"],
        "findings": report["findings"],
        "documents": report["documents"],
    }, ensure_ascii=False))
