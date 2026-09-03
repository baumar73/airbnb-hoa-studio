const CASES_KEY = 'cases';
const CIPHER_VERSION = 'aes-256-gcm-v1';

function bytesToB64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(value) {
  const raw = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = raw + '='.repeat((4 - raw.length % 4) % 4);
  return Uint8Array.from(atob(padded), ch => ch.charCodeAt(0));
}

async function encryptionKey(env) {
  const bytes = b64urlToBytes(env && env.DATA_ENCRYPTION_KEY);
  if (bytes.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function sealWizard(c, env) {
  if (!c.wizard) return { ...c };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(`hoa-case:${c.id}:${CIPHER_VERSION}`);
  const plaintext = new TextEncoder().encode(JSON.stringify(c.wizard));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, await encryptionKey(env), plaintext);
  const stored = { ...c, wizardCipherVersion: CIPHER_VERSION, wizardIv: bytesToB64url(iv), wizardCiphertext: bytesToB64url(new Uint8Array(encrypted)) };
  delete stored.wizard;
  return stored;
}

async function openWizard(c, env) {
  if (!c.wizardCiphertext) return { ...c };
  if (c.wizardCipherVersion !== CIPHER_VERSION) throw new Error(`unsupported wizard encryption version: ${c.wizardCipherVersion}`);
  const iv = b64urlToBytes(c.wizardIv);
  const aad = new TextEncoder().encode(`hoa-case:${c.id}:${CIPHER_VERSION}`);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, await encryptionKey(env), b64urlToBytes(c.wizardCiphertext));
  const opened = { ...c, wizard: JSON.parse(new TextDecoder().decode(plaintext)) };
  delete opened.wizardCiphertext;
  delete opened.wizardCipherVersion;
  delete opened.wizardIv;
  return opened;
}

export async function loadStoredCases(env) {
  const raw = await env.CASES.get(CASES_KEY);
  const stored = raw ? JSON.parse(raw) : [];
  return Promise.all(stored.map(c => openWizard(c, env)));
}

export async function saveStoredCases(env, cases) {
  const stored = await Promise.all((cases || []).map(c => sealWizard(c, env)));
  await env.CASES.put(CASES_KEY, JSON.stringify(stored));
}

export async function getEncryptedSecret(env, name) {
  const raw = await env.CASES.get(`secret:${name}`);
  if (!raw) {
    // One-time migration path from the earlier plaintext owner-signature key.
    if (name === 'owner-signature-png') return env.CASES.get('owner-signature-png');
    return null;
  }
  const record = JSON.parse(raw);
  if (record.version !== CIPHER_VERSION) throw new Error(`unsupported secret encryption version: ${record.version}`);
  const iv = b64urlToBytes(record.iv);
  const aad = new TextEncoder().encode(`hoa-secret:${name}:${CIPHER_VERSION}`);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, await encryptionKey(env), b64urlToBytes(record.ciphertext));
  return new TextDecoder().decode(plaintext);
}

export async function putEncryptedSecret(env, name, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(`hoa-secret:${name}:${CIPHER_VERSION}`);
  const plaintext = new TextEncoder().encode(String(value));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, await encryptionKey(env), plaintext);
  await env.CASES.put(`secret:${name}`, JSON.stringify({ version: CIPHER_VERSION, iv: bytesToB64url(iv), ciphertext: bytesToB64url(new Uint8Array(encrypted)) }));
  if (name === 'owner-signature-png') await env.CASES.delete('owner-signature-png');
}
