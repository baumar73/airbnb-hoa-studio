#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { basename, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PROPERTY_CONFIG, liveSubmissionEnabled } from '../functions/lib/property-config.js';
import { submissionRecipients } from '../functions/lib/workflow.js';

const portalRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const repoRoot = resolve(portalRoot, '..');
const textExtensions = new Set(['.js', '.mjs', '.py', '.sh', '.applescript', '.html', '.css', '.json', '.txt', '.xml', '.toml', '.webmanifest', '.md']);

async function collect(path, output = []) {
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    if (['node_modules', '.wrangler', '.git', '__pycache__'].includes(entry.name)) continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) await collect(child, output);
    else if (textExtensions.has(extname(entry.name)) || entry.name === 'wrangler.toml') output.push(child);
  }
  return output;
}

async function runtimeFiles() {
  const roots = [
    join(portalRoot, 'functions'),
    join(portalRoot, 'cron', 'src'),
    join(portalRoot, 'public'),
    join(repoRoot, 'operations', 'public'),
  ];
  const files = [];
  for (const root of roots) await collect(root, files);
  const operationsTools = await collect(join(repoRoot, 'operations', 'tools'));
  files.push(...operationsTools.filter((file) => {
    const name = basename(file);
    return !name.includes('_test.') && !name.startsWith('test_') && name !== 'ui_contract_check.py';
  }));
  files.push(
    join(portalRoot, 'wrangler.toml'),
    join(portalRoot, 'cron', 'wrangler.toml'),
    join(portalRoot, 'package.json'),
    join(portalRoot, 'scripts', 'run_local_ai_review.py'),
    join(portalRoot, 'scripts', 'generate_review_bundle.mjs'),
    join(repoRoot, 'operations', 'server.mjs'),
  );
  return [...new Set(files)];
}

export async function runProductionPreflight() {
  const failures = [];
  const expected = {
    portalOrigin: 'https://isladelsol405d.com',
    listingId: '1097686557541958107',
    condominiumName: 'Palma del Mar No. 2',
    managementName: 'Condominium Associates, Inc.',
    unit: 'Unit 405D',
    ownerName: 'Markus Oliver Bauer',
  };
  for (const [key, value] of Object.entries(expected)) {
    if (PROPERTY_CONFIG[key] !== value) failures.push(`PROPERTY_CONFIG.${key} is not canonical`);
  }
  const recipients = submissionRecipients();
  if (JSON.stringify(recipients) !== JSON.stringify({
    to: ['info@condominiumassociates.com', 'kruiz@condominiumassociates.com'],
    cc: [],
  })) failures.push('HOA recipients are not the reviewed production allowlist');
  if (liveSubmissionEnabled() !== false) failures.push('live HOA submission must remain hard-disabled');

  const requiredPublicAssets = new Map([
    ['favicon.svg', '633653ba7c1b990c76337e7f41a1902f5096544682a1ee53791819cf05efe34d'],
    ['forms/guest-registration.pdf', 'd40d0012874f020ea7f7402ad69d17fa294fe0f1e03e58e8ccc66db6dc21c3cf'],
    ['forms/rules-and-regulations.pdf', 'edc462d020166cf49d75c7d24b0db13167aaf3a93c2a76370d37de42b13cdc89'],
  ]);
  for (const [asset, expectedSha256] of requiredPublicAssets) {
    try {
      const bytes = await readFile(join(portalRoot, 'public', asset));
      const actual = createHash('sha256').update(bytes).digest('hex');
      if (actual !== expectedSha256) failures.push(`public asset ${asset} does not match the reviewed source`);
    } catch (_) {
      failures.push(`required public asset ${asset} is missing`);
    }
  }

  const forbidden = [
    ['review-only property name', /Example Island/g],
    ['review-only condominium name', /Example Condominium/g],
    ['review-only portal domain', /portal\.example\.test/g],
    ['review-only listing identifier', /DEMOID0002/g],
    ['review-only email recipient', /contact\d{3}@example\.test/g],
    ['review-only street address', /100 Example Avenue/g],
    ['review-only management name', /Example Property Management/g],
    ['review-only person token', /Demo(?:GivenName|Surname|Name)[A-Z]/g],
    ['documentation-only IP address', /192\.0\.2\.\d+/g],
    ['review-only user home', /\/(?:Users|home)\/demo-user/g],
    ['review-only launch-agent label', /com\.demo-user\./g],
    ['zero Cloudflare KV namespace', /\b0{32}\b/g],
  ];
  for (const file of await runtimeFiles()) {
    const source = await readFile(file, 'utf8');
    for (const [label, pattern] of forbidden) {
      pattern.lastIndex = 0;
      if (pattern.test(source)) failures.push(`${relative(repoRoot, file)} contains ${label}`);
    }
  }

  const wrangler = await readFile(join(portalRoot, 'wrangler.toml'), 'utf8');
  if (!wrangler.includes('id = "d14475cc0abe4834b1ac60daca8567b0"')) failures.push('production CASES KV id is missing');
  if (!wrangler.includes('id = "fdd598833b26455bab745d6d135d547a"')) failures.push('preview CASES KV id is missing');
  if (!wrangler.includes('name = "isla-405d"')) failures.push('Cloudflare Pages project name is wrong');
  const cronWrangler = await readFile(join(portalRoot, 'cron', 'wrangler.toml'), 'utf8');
  if (!cronWrangler.includes('id = "d14475cc0abe4834b1ac60daca8567b0"')) failures.push('cron worker does not bind the reviewed production CASES namespace');

  const router = await readFile(join(portalRoot, 'functions', '[[path]].js'), 'utf8');
  if (!router.includes("receipt email export disabled until recipients are explicitly configured and reviewed")) failures.push('receipt export is not fail-closed');
  if (!router.includes("file upload disabled until content-level sensitive-data scanning is configured")) failures.push('binary uploads are not fail-closed');
  if (/CASES\.get\(['"]submit-live['"]\)/.test(router)) failures.push('router still reads mutable submit-live KV state');

  const submit = await readFile(join(portalRoot, 'functions', 'lib', 'submit.js'), 'utf8');
  if (/CASES\.get\(['"]submit-live['"]\)/.test(submit)) failures.push('submission path still reads mutable submit-live KV state');
  if (!submit.includes('const live = liveSubmissionEnabled();')) failures.push('submission path does not use the hard code-level live gate');

  const operationsServer = await readFile(join(repoRoot, 'operations', 'server.mjs'), 'utf8');
  if (!operationsServer.includes('cases: []')) failures.push('clean Operations seed is not empty');
  if (!operationsServer.includes('Hermes sync is disabled until HERMES_HOST and HERMES_SYNC_PATH are explicitly configured')) failures.push('Hermes sync is not fail-closed');

  return { ok: failures.length === 0, failures, checkedRuntimeFiles: (await runtimeFiles()).length };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const result = await runProductionPreflight();
  if (!result.ok) {
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(result, null, 2));
}
