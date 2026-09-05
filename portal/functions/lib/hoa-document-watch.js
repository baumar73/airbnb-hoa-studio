// Pure reconciliation for a private HOA document collector. No credentials,
// browser access, external writes, approval decisions or runtime policy changes.
const WEEK=7*86400000, RETRY=6*3600000, LIMIT=10000;
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,160}$/.test(value)&&!['__proto__','constructor','prototype'].includes(value);
function fail(code) { throw Object.assign(new Error(code),{code}); }
function time(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value) fail('DOCUMENT_TIME_INVALID');
  return Date.parse(value);
}
function clock(now) { if(!(now instanceof Date)||!Number.isFinite(now.getTime())) fail('DOCUMENT_TIME_INVALID');return now.getTime(); }
function stateValid(state) {
  if(!state||state.protocol!==1||!id(state.source)||!state.documents||Array.isArray(state.documents)||typeof state.documents!=='object'||Object.keys(state.documents).length>LIMIT||!Array.isArray(state.indexedHashes)||state.indexedHashes.length>LIMIT||!state.indexedHashes.every(hash)) fail('DOCUMENT_STATE_INVALID');
  time(state.lastSuccessAt);time(state.lastAttemptAt);
  for(const [key,d] of Object.entries(state.documents)) {
    if(!id(key)||!d||d.id!==key||!hash(d.sha256)||typeof d.title!=='string'||!d.title||d.title.length>500||typeof d.available!=='boolean'||!Array.isArray(d.versions)||!d.versions.length||d.versions.length>1000||!d.versions.every(hash)||!d.versions.includes(d.sha256)) fail('DOCUMENT_STATE_INVALID');
  }
}
export function reconcileHoaDocuments(previous,snapshot,now=new Date()) {
  const at=clock(now);
  if(previous)stateValid(previous);
  if(!snapshot||!id(snapshot.source))fail('DOCUMENT_SOURCE_INVALID');
  if(snapshot.authenticated!==true)fail('LOGIN_REQUIRED');
  if(snapshot.complete!==true)fail('INVENTORY_INCOMPLETE');
  if(previous&&previous.source!==snapshot.source)fail('DOCUMENT_SOURCE_MISMATCH');
  const observed=time(snapshot.observedAt);
  if(observed>at||at-observed>3600000||(previous&&observed<time(previous.lastSuccessAt)))fail('DOCUMENT_SNAPSHOT_STALE');
  if(!Array.isArray(snapshot.documents)||snapshot.documents.length>LIMIT)fail('DOCUMENT_INVENTORY_INVALID');
  const seen=new Set();
  for(const d of snapshot.documents) {
    if(!d||!id(d.id)||seen.has(d.id)||!hash(d.sha256)||typeof d.title!=='string'||!d.title.trim()||d.title.length>500)fail('DOCUMENT_INVENTORY_INVALID');
    seen.add(d.id);
  }
  const state=previous?structuredClone(previous):{protocol:1,source:snapshot.source,documents:{},indexedHashes:[]};
  if(new Set([...Object.keys(state.documents),...seen]).size>LIMIT)fail('DOCUMENT_STATE_LIMIT');
  const events=[],indexQueue=[];
  for(const d of snapshot.documents) {
    const old=state.documents[d.id],changed=old&&old.sha256!==d.sha256;
    const versions=[...new Set([...(old?.versions||[]),d.sha256])];
    if(versions.length>1000)fail('DOCUMENT_STATE_LIMIT');
    if(!old||changed||!old.available||old.title!==d.title)events.push({id:d.id,type:!old?'added':changed?'changed':!old.available?'returned':'renamed',sha256:d.sha256,previousSha256:old?.sha256||null});
    state.documents[d.id]={id:d.id,title:d.title,sha256:d.sha256,versions,available:true};
    if(!state.indexedHashes.includes(d.sha256)&&!indexQueue.some(q=>q.sha256===d.sha256))
      indexQueue.push({id:d.id,sha256:d.sha256,reviewStatus:'unreviewed-source'});
  }
  for(const [key,d] of Object.entries(state.documents))if(!seen.has(key)&&d.available) {
    d.available=false;events.push({id:key,type:'missing',sha256:d.sha256});
  }
  // Disappearance is evidence to review, not permission to delete an original
  // or conclude that a restriction has been revoked.
  state.lastSuccessAt=snapshot.observedAt;state.lastAttemptAt=now.toISOString();state.lastError=null;
  return {state,events,indexQueue};
}
export function hoaDocumentWatchStatus(state,now=new Date()) {
  const at=clock(now);
  if(!state)return {due:true,attention:'NOT_INITIALIZED',nextCheckAt:null};
  stateValid(state);
  const success=time(state.lastSuccessAt),attempt=time(state.lastAttemptAt);
  if(success>at||attempt>at)fail('DOCUMENT_CLOCK_ROLLBACK');
  const next=state.lastError?attempt+RETRY:success+WEEK;
  return {due:at>=next,attention:state.lastError||(at>=success+WEEK?'CHECK_OVERDUE':null),nextCheckAt:new Date(next).toISOString()};
}
