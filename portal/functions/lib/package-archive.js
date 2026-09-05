import {encryptPrivateJson,decryptPrivateJson,caseSnapshotVersion,CaseStoreError} from './storage.js';

const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
const b64=bytes=>{let text='';for(let i=0;i<bytes.length;i+=8192) text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);};
const bytes=value=>Uint8Array.from(atob(value),ch=>ch.charCodeAt(0));
const actor=env=>{
  if(!env.CASE_STORE) throw new CaseStoreError('CASE_STORE_UNAVAILABLE','Package archive requires atomic storage');
  return env.CASE_STORE.get(env.CASE_STORE.idFromName('reservations-v1'));
};
const names=['01-lease-application.pdf','02-background-authorization.pdf','03-rules-and-acknowledgment.pdf','04-short-term-lease.pdf','05-flood-disclosure.pdf'];

export async function archivePackage(env,cases,c,attachments,contextHash,now=new Date()) {
  if(!Array.isArray(attachments)||!attachments.length||attachments.length>5) throw new Error('invalid package size');
  const filenames=new Set();
  for(const a of attachments) {
    if(!a||typeof a.filename!=='string'||!a.filename.length||a.filename.length>255||/[\x00-\x1f\x7f"\\/]/.test(a.filename)||!a.filename.toLowerCase().endsWith('.pdf')||!(a.bytes instanceof Uint8Array)||!a.bytes.length||filenames.has(a.filename)) throw new Error('invalid package attachment');
    filenames.add(a.filename);
  }
  if(attachments.reduce((n,a)=>n+a.bytes.length,0)>8_000_000) throw new Error('invalid package size');
  const id=crypto.randomUUID();
  const documents=await Promise.all(attachments.map(async(a,i)=>({filename:a.filename,reviewFilename:c.pathType==='full'?names[i]:'01-guest-registration.pdf',sha256:await digest(a.bytes),size:a.bytes.length})));
  const packageHash=await digest(new TextEncoder().encode(JSON.stringify(documents)));
  const manifest={id,reviewHash:c.reviewHash,contextHash,packageHash,documents,createdAt:now.toISOString()};
  const encrypted=await encryptPrivateJson(env,`package:${c.id}:${id}`,attachments.map(a=>({filename:a.filename,base64:b64(a.bytes)})));
  const response=await actor(env).fetch('https://case-store/packages',{method:'POST',body:JSON.stringify({caseId:c.id,expectedVersion:caseSnapshotVersion(cases,c.id),manifest,encrypted})});
  if(response.status===409) throw new CaseStoreError('CASE_CONFLICT','Case changed during package preparation');
  if(!response.ok) throw new CaseStoreError('CASE_ARCHIVE_FAILED','Package snapshot could not be stored');
  return manifest;
}

export async function loadArchivedPackage(env,c) {
  const expected=c.preparedPackage;
  if(!expected) throw new CaseStoreError('CASE_ARCHIVE_MISSING','No immutable review package exists');
  const response=await actor(env).fetch(`https://case-store/packages?caseId=${encodeURIComponent(c.id)}&id=${encodeURIComponent(expected.id)}`);
  if(!response.ok) throw new CaseStoreError('CASE_ARCHIVE_MISSING','Immutable review package is unavailable');
  const {manifest,encrypted}=await response.json();
  const computedHash=await digest(new TextEncoder().encode(JSON.stringify(manifest.documents)));
  if(manifest.id!==expected.id || manifest.packageHash!==expected.packageHash || computedHash!==expected.packageHash || manifest.reviewHash!==expected.reviewHash || manifest.contextHash!==expected.contextHash) throw new CaseStoreError('CASE_ARCHIVE_INVALID','Package manifest does not match its recorded version');
  const payload=await decryptPrivateJson(env,`package:${c.id}:${expected.id}`,encrypted);
  if(payload.length!==manifest.documents.length) throw new CaseStoreError('CASE_ARCHIVE_INVALID','Package document count changed');
  const attachments=[];
  for(let i=0;i<payload.length;i++) {
    const document=manifest.documents[i],data=bytes(payload[i].base64);
    if(payload[i].filename!==document.filename || data.length!==document.size || await digest(data)!==document.sha256) throw new CaseStoreError('CASE_ARCHIVE_INVALID','Archived document integrity check failed');
    attachments.push({filename:document.filename,bytes:data});
  }
  return {manifest,attachments};
}

export function reviewPackagePayload(archive) {
  return {packageId:archive.manifest.id,packageHash:archive.manifest.packageHash,documents:archive.attachments.map((a,i)=>({...archive.manifest.documents[i],base64:b64(a.bytes)}))};
}
