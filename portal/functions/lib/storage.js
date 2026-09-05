const CASES_KEY = 'cases';
const CIPHER_VERSION = 'aes-256-gcm-v1';
const SNAPSHOT = Symbol('case-snapshot');

export class CaseStoreError extends Error {
  constructor(code, message) { super(message); this.code=code; }
}
function attachSnapshot(cases, versions, baseline = new Map(cases.map(c=>[c.id,JSON.stringify(c)]))) {
  Object.defineProperty(cases,SNAPSHOT,{value:{versions:{...versions},baseline},configurable:true});
  return cases;
}
export function inheritCaseSnapshot(source, target, normalized = false) {
  const snap=source[SNAPSHOT];
  if (snap) attachSnapshot(target,snap.versions,normalized ? undefined : snap.baseline);
  return target;
}
export function caseSnapshotVersion(cases,id) {
  const snap=cases[SNAPSHOT];
  if(!snap) throw new CaseStoreError('CASE_SNAPSHOT_REQUIRED','A versioned reservation snapshot is required');
  return Object.hasOwn(snap.versions,id)?snap.versions[id]:0;
}
function caseStore(env) {
  if (env.CASE_STORE) return env.CASE_STORE.get(env.CASE_STORE.idFromName('reservations-v1'));
  if (env.REQUIRE_ATOMIC_CASES==='yes') throw new CaseStoreError('CASE_STORE_UNAVAILABLE','Atomic case storage is not configured');
  return null; // Legacy compatibility for the staged, explicitly approved cutover.
}
async function storeRequest(store, method, body) {
  const res=await store.fetch('https://case-store/cases',{method,headers:{'Content-Type':'application/json'},body:body ? JSON.stringify(body) : undefined});
  if (res.status===409) throw new CaseStoreError('CASE_CONFLICT','This reservation changed while you were working. Reload before saving again.');
  if (!res.ok) throw new CaseStoreError('CASE_STORE_UNAVAILABLE','Reservation storage is temporarily unavailable');
  return res.json();
}

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

export async function encryptPrivateJson(env,purpose,value) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const aad=new TextEncoder().encode(`hoa-private:${purpose}:${CIPHER_VERSION}`);
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},await encryptionKey(env),new TextEncoder().encode(JSON.stringify(value)));
  // Chunk the base64 conversion to avoid spreading a large PDF into the stack.
  const data=new Uint8Array(encrypted);let binary='';
  for(let i=0;i<data.length;i+=8192) binary+=String.fromCharCode(...data.subarray(i,i+8192));
  return {version:CIPHER_VERSION,iv:bytesToB64url(iv),ciphertext:btoa(binary)};
}
export async function decryptPrivateJson(env,purpose,record) {
  if(record.version!==CIPHER_VERSION) throw new Error('unsupported private-data encryption version');
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64urlToBytes(record.iv),additionalData:new TextEncoder().encode(`hoa-private:${purpose}:${CIPHER_VERSION}`)},await encryptionKey(env),b64urlToBytes(record.ciphertext));
  return JSON.parse(new TextDecoder().decode(plain));
}

async function sealWizard(c, env) {
  c={...c};
  if(c.guestContact) {
    c.guestContactEncrypted=await encryptPrivateJson(env,'guest-contact:'+c.id,c.guestContact);
    delete c.guestContact;
  }
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
  c={...c};
  if(c.guestContactEncrypted) {
    c.guestContact=await decryptPrivateJson(env,'guest-contact:'+c.id,c.guestContactEncrypted);
    delete c.guestContactEncrypted;
  }
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
  const store=caseStore(env);
  if (store) {
    const {cases,versions}=await storeRequest(store,'GET');
    return attachSnapshot(await Promise.all(cases.map(c=>openWizard(c,env))),versions);
  }
  const raw = await env.CASES.get(CASES_KEY);
  const stored = raw ? JSON.parse(raw) : [];
  return Promise.all(stored.map(c => openWizard(c, env)));
}

export async function loadKnowledgeChanges(env,{cursor,limit}={}) {
  // This interface must NEVER fall back to unversioned KV snapshots.
  if(!env.CASE_STORE) throw new CaseStoreError('CASE_STORE_UNAVAILABLE','Atomic case storage is required');
  const url=new URL('https://case-store/knowledge-changes');
  if(cursor!==null&&cursor!==undefined)url.searchParams.set('cursor',cursor);
  if(limit!==null&&limit!==undefined)url.searchParams.set('limit',limit);
  const res=await caseStore(env).fetch(url.toString(),{method:'GET'});
  if(res.status===400)throw new CaseStoreError('CASE_EXPORT_INPUT','Invalid export checkpoint');
  if(res.status===409)throw new CaseStoreError('CASE_EXPORT_RESET','Export requires reconciliation');
  if(!res.ok)throw new CaseStoreError('CASE_STORE_UNAVAILABLE','Export unavailable');
  const page=await res.json();
  page.changes=await Promise.all(page.changes.map(async c=>({...c,value:c.value?await openWizard(c.value,env):null})));
  return page;
}

export async function saveStoredCases(env, cases) {
  const store=caseStore(env);
  if (store) {
    const snap=cases[SNAPSHOT];
    if (!snap) throw new CaseStoreError('CASE_SNAPSHOT_REQUIRED','Saving requires a versioned reservation snapshot');
    if (new Set(cases.map(c=>c.id)).size!==cases.length) throw new Error('duplicate case IDs');
    const current=new Map(cases.map(c=>[c.id,c]));
    const changes=[];
    for (const c of cases) {
      if (snap.baseline.get(c.id)!==JSON.stringify(c)) changes.push({id:c.id,expectedVersion:snap.versions[c.id]||0,value:await sealWizard(c,env)});
    }
    for (const id of snap.baseline.keys()) {
      if (!current.has(id)) changes.push({id,expectedVersion:snap.versions[id]||0,value:null});
    }
    if (!changes.length) return;
    const {revision}=await storeRequest(store,'PATCH',{changes});
    const versions={...snap.versions};
    for (const c of changes) versions[c.id]=revision;
    attachSnapshot(cases,versions);
    return;
  }
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
