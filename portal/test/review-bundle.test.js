import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return chunk;
}

function validSignaturePng(marker = 0) {
  const width = 120, height = 40;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const rows = Buffer.alloc((width * 3 + 1) * height, 255);
  for (let y = 0; y < height; y++) rows[y * (width * 3 + 1)] = 0;
  for (let x = 15; x < 105; x++) {
    const y = 10 + ((x + marker) % 20);
    const offset = y * (width * 3 + 1) + 1 + x * 3;
    rows[offset] = marker; rows[offset + 1] = 0; rows[offset + 2] = 0;
  }
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
}

function headerOnlyInvalidPng() {
  const bytes = Buffer.alloc(140);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes, 0);
  Buffer.from('IHDR', 'ascii').copy(bytes, 12);
  bytes.writeUInt32BE(120, 16);
  bytes.writeUInt32BE(40, 20);
  return bytes.toString('base64');
}

test('review bundle emits only the two minimized coordination PDFs', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hoa-review-bundle-'));
  try {
    const forms = path.join(temp, 'forms');
    const output = path.join(temp, 'output');
    fs.mkdirSync(forms);
    const rules = await PDFDocument.create();
    rules.addPage([612, 792]);
    fs.writeFileSync(path.join(forms, 'rules-and-regulations.pdf'), await rules.save());

    const signature = validSignaturePng();
    const candidate = {
      id: 'synthetic', guestName: 'Synthetic Guest', reservationCode: 'HMTESTSAFE',
      checkIn: '2026-10-17', checkOut: '2026-12-20', nights: 64, adults: 1,
      pathType: 'full', reviewHash: 'synthetic',
      wizard: {
        adults: [{
          firstName: 'Synthetic', middleName: 'None', lastName: 'Guest',
          phone: '+1-555-000-005', email: 'synthetic@example.test',
          street: '1 Main Street', city: 'St Petersburg', state: 'FL', zip: '33715',
          sigPng: signature, esignConsent: true,
          birthDate: '2000-01-01', idNumber: 'MUST-NOT-BE-USED',
        }],
        rulesAcknowledged: true,
        esignConsent: true,
        emergency: [{ name: 'MUST-NOT-BE-USED' }],
      },
    };
    const casePath = path.join(temp, 'case.json');
    const signaturePath = path.join(temp, 'owner.sig');
    fs.writeFileSync(casePath, JSON.stringify(candidate));
    fs.writeFileSync(signaturePath, signature);

    const generated = spawnSync(process.execPath, ['scripts/generate_review_bundle.mjs', casePath, signaturePath, output], {
      cwd: path.resolve('.'),
      env: { ...process.env, ISLA_FORMS_ROOT: forms },
      encoding: 'utf8',
    });
    assert.equal(generated.status, 0, generated.stderr || generated.stdout);
    const result = JSON.parse(generated.stdout);
    assert.equal(result.ok, true);
    assert.match(result.bundleDigest, /^[0-9a-f]{64}$/);
    assert.deepEqual(fs.readdirSync(output).sort(), [
      '01-rules-and-acknowledgment.pdf',
      '02-short-term-lease.pdf',
    ]);

    // An exact-artifact approval is usable only if identical inputs render
    // byte-for-byte identically across separate processes and clock ticks.
    await new Promise(resolve => setTimeout(resolve, 1100));
    const repeatOutput = path.join(temp, 'output-repeat');
    const repeated = spawnSync(process.execPath, ['scripts/generate_review_bundle.mjs', casePath, signaturePath, repeatOutput], {
      cwd: path.resolve('.'),
      env: { ...process.env, ISLA_FORMS_ROOT: forms },
      encoding: 'utf8',
    });
    assert.equal(repeated.status, 0, repeated.stderr || repeated.stdout);
    assert.equal(JSON.parse(repeated.stdout).bundleDigest, result.bundleDigest);

    const secondOutput = path.join(temp, 'output-second-owner-signature');
    fs.writeFileSync(signaturePath, validSignaturePng(7));
    const changed = spawnSync(process.execPath, ['scripts/generate_review_bundle.mjs', casePath, signaturePath, secondOutput], {
      cwd: path.resolve('.'),
      env: { ...process.env, ISLA_FORMS_ROOT: forms },
      encoding: 'utf8',
    });
    assert.equal(changed.status, 0, changed.stderr || changed.stdout);
    const changedResult = JSON.parse(changed.stdout);
    assert.notEqual(changedResult.bundleDigest, result.bundleDigest);
    assert.equal(changedResult.reviewHash, result.reviewHash);

    candidate.wizard.adults[0].sigPng = headerOnlyInvalidPng();
    fs.writeFileSync(casePath, JSON.stringify(candidate));
    const malformed = spawnSync(process.execPath, ['scripts/generate_review_bundle.mjs', casePath, signaturePath, path.join(temp, 'output-malformed')], {
      cwd: path.resolve('.'),
      env: { ...process.env, ISLA_FORMS_ROOT: forms },
      encoding: 'utf8',
    });
    assert.notEqual(malformed.status, 0, 'structurally invalid signature PNG must fail closed');
    assert.match(malformed.stderr, /invalid tenant signature PNG/i);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('local AI reader strips prohibited legacy data before bundle or prompt use', () => {
  const probe = String.raw`
import importlib.util, json, sys, types
sys.modules.setdefault("fitz", types.SimpleNamespace())
spec = importlib.util.spec_from_file_location("run_local_ai_review", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
payload = [{
  "id": "synthetic",
  "wizard": {"birthDate": "2000-01-01", "idType": "passport", "emergency": [{"phone": "555"}]},
  "timeline": [
    {"text": "Synthetic SSN 123-45-6789"},
    {"text": "credit score = 700"}
  ],
  "safe": "retained"
}]
module.remote_kv_get = lambda key: json.dumps(payload)
print(json.dumps(module.load_sanitized_cases(), sort_keys=True))
`;
  const result = spawnSync('python3', ['-c', probe, 'scripts/run_local_ai_review.py'], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const sanitized = JSON.parse(result.stdout);
  assert.equal(sanitized[0].safe, 'retained');
  assert.deepEqual(sanitized[0].wizard, {});
  assert.equal(sanitized[0].timeline[0].text, '[REDACTED PROHIBITED SENSITIVE DATA]');
  assert.equal(sanitized[0].timeline[1].text, '[REDACTED PROHIBITED SENSITIVE DATA]');
});