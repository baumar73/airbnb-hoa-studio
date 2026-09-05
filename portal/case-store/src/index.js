// One private Durable Object coordinates reservation updates. No public worker
// route exposes this API. Form contents arrive already application-encrypted.
const response = (data, status = 200) => Response.json(data, {status, headers:{'Cache-Control':'no-store'}});
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(id);
const versionOf = (versions,id) => Object.hasOwn(versions,id) ? versions[id] : 0;
const validRecord = c => c && validId(c.id) && !Object.hasOwn(c,'wizard') &&
  (!c.wizardCiphertext || (c.wizardCipherVersion === 'aes-256-gcm-v1' && typeof c.wizardIv === 'string'));

export class CaseStore {
  constructor(state, env) { this.storage=state.storage; this.env=env; }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    if(path==='/knowledge-changes') return this.knowledgeChanges(request);
    if(path==='/packages') return this.packages(request);
    if (path === '/initialize' && request.method === 'POST') {
      // Explicit one-time import, usable only during a confirmed writer pause.
      if (this.env.ALLOW_CASE_IMPORT !== 'yes' || !this.env.LEGACY_CASES) return response({error:'import disabled'},403);
      const {expectedHash, expectedCount} = await request.json();
      const raw = await this.env.LEGACY_CASES.get('cases') || '[]';
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)))].map(b=>b.toString(16).padStart(2,'0')).join('');
      const cases = JSON.parse(raw);
      if (digest !== expectedHash || !Array.isArray(cases) || cases.length !== expectedCount || !cases.every(validRecord) || new Set(cases.map(c=>c.id)).size!==cases.length) return response({error:'import does not match verified encrypted snapshot'},409);
      return this.storage.transaction(async tx=>{
        if (await tx.get('snapshot')) return response({error:'already initialized'},409);
        const versions=Object.fromEntries(cases.map(c=>[c.id,1]));
        for (const c of cases) await tx.put('case:'+c.id,c);
        await tx.put('snapshot',{revision:1,versions,ids:cases.map(c=>c.id)});
        return response({revision:1,count:cases.length});
      });
    }
    if (path !== '/cases') return response({error:'not found'},404);
    if (request.method === 'GET') return this.storage.transaction(async tx=>{
      const snapshot=await tx.get('snapshot');
      if (!snapshot) return response({error:'case store must be explicitly initialized'},503);
      const cases=[];
      for (const id of snapshot.ids) cases.push(await tx.get('case:'+id));
      return response({...snapshot,cases});
    });
    if (request.method !== 'PATCH') return response({error:'method not allowed'},405);
    const {changes} = await request.json();
    if (!Array.isArray(changes) || changes.length>1000 || new Set(changes.map(c=>c?.id)).size!==changes.length || !changes.every(c=>validId(c?.id) && Number.isSafeInteger(c.expectedVersion) && c.expectedVersion>=0 && (c.value===null || (validRecord(c.value) && c.value.id===c.id)))) return response({error:'invalid changes'},400);
    return this.storage.transaction(async tx=>{
      const current=await tx.get('snapshot');
      if (!current) return response({error:'case store must be explicitly initialized'},503);
      if (changes.some(c=>versionOf(current.versions,c.id)!==c.expectedVersion)) return response({error:'case changed; reload before saving'},409);
      // Duplicate booking references cannot race through independent imports.
      const records=new Map();
      for (const id of current.ids) records.set(id,await tx.get('case:'+id));
      for (const change of changes) {
        if (change.value===null) records.delete(change.id);
        else records.set(change.id,change.value);
      }
      const codes=[...records.values()].map(c=>String(c.reservationCode||'').toUpperCase()).filter(Boolean);
      if (new Set(codes).size!==codes.length) return response({error:'reservation code already exists'},409);
      const revision=current.revision+1;
      for (const change of changes) {
        // Retain a version tombstone after deletion to reject stale resurrection.
        current.versions[change.id]=revision;
        if (change.value===null) {
          await this.removePackages(tx,change.id);
          await tx.delete('case:'+change.id);
        }
        else await tx.put('case:'+change.id,change.value);
      }
      await tx.put('snapshot',{revision,versions:current.versions,ids:[...records.keys()]});
      return response({revision});
    });
  }

  async knowledgeChanges(request) {
    if(request.method!=='GET') return response({error:'read-only'},405);
    const url=new URL(request.url),rawLimit=url.searchParams.get('limit')??'50';
    if(!/^\d+$/.test(rawLimit)||Number(rawLimit)<1||Number(rawLimit)>100) return response({error:'invalid limit'},400);
    let cursor=null;
    const raw=url.searchParams.get('cursor');
    if(raw!==null) {
      try {
        if(raw.length>512||!/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
        cursor=JSON.parse(atob(raw.replace(/-/g,'+').replace(/_/g,'/')));
        if(!Array.isArray(cursor)||cursor.length!==3||typeof cursor[0]!=='string'||! /^[a-f0-9-]{36}$/.test(cursor[0])||!Number.isSafeInteger(cursor[1])||cursor[1]<0||!(cursor[2]===''||cursor[2]==='~'||validId(cursor[2]))) throw new Error();
      } catch {return response({error:'invalid cursor'},400);}
    }
    return this.storage.transaction(async tx=>{
      const snapshot=await tx.get('snapshot');
      if(!snapshot) return response({error:'atomic store not initialized'},503);
      // Persist only a non-personal stream identity, never a second guest queue.
      // The existing version tombstones are the durable source of deletions.
      let epoch=await tx.get('knowledge-epoch');
      if(!epoch) {epoch=crypto.randomUUID();await tx.put('knowledge-epoch',epoch);}
      if(cursor&&(cursor[0]!==epoch||cursor[1]>snapshot.revision)) return response({error:'checkpoint requires reconciliation'},409);
      const after=cursor||[epoch,0,''];
      const entries=Object.entries(snapshot.versions).filter(([id,version])=>version>after[1]||(version===after[1]&&id>after[2]))
        .sort(([a,av],[b,bv])=>av-bv||(a<b?-1:a>b?1:0));
      const selected=entries.slice(0,Number(rawLimit)),active=new Set(snapshot.ids),changes=[];
      for(const [id,revision] of selected) {
        const value=active.has(id)?await tx.get('case:'+id):null;
        if(active.has(id)&&!value) return response({error:'incomplete case snapshot'},503);
        changes.push({id,revision,value});
      }
      const hasMore=entries.length>selected.length,last=selected.at(-1);
      const next=hasMore?[epoch,last[1],last[0]]:[epoch,snapshot.revision,'~'];
      const nextCursor=btoa(JSON.stringify(next)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
      return response({protocol:1,epoch,throughRevision:snapshot.revision,changes,hasMore,nextCursor});
    });
  }

  async packages(request) {
    const url=new URL(request.url);
    if(request.method==='GET') {
      const caseId=url.searchParams.get('caseId'),id=url.searchParams.get('id');
      if(!validId(caseId)||!validId(id)) return response({error:'invalid package ID'},400);
      return this.storage.transaction(async tx=>{
        if(!await tx.get('case:'+caseId)) return response({error:'not found'},404);
        const key=`package:${caseId}:${id}`,meta=await tx.get(key);
        if(!meta) return response({error:'not found'},404);
        let ciphertext='';
        for(let i=0;i<meta.chunkCount;i++) {
          const chunk=await tx.get(`${key}:${i}`);
          if(typeof chunk!=='string') return response({error:'incomplete archive'},503);
          ciphertext+=chunk;
        }
        return response({manifest:meta.manifest,encrypted:{...meta.encryption,ciphertext}});
      });
    }
    if(request.method!=='POST') return response({error:'method not allowed'},405);
    let body;try {body=await request.json();} catch {return response({error:'invalid JSON'},400);}
    const {caseId,expectedVersion,manifest,encrypted}=body;
    if(!validId(caseId)||!validId(manifest?.id)||!Number.isSafeInteger(expectedVersion)||typeof manifest.reviewHash!=='string'||typeof manifest.contextHash!=='string'||!/^[a-f0-9]{64}$/.test(manifest.packageHash)||!Array.isArray(manifest.documents)||manifest.documents.length<1||manifest.documents.length>5||encrypted?.version!=='aes-256-gcm-v1'||typeof encrypted.iv!=='string'||typeof encrypted.ciphertext!=='string'||encrypted.ciphertext.length>16_000_000) return response({error:'invalid encrypted package'},400);
    return this.storage.transaction(async tx=>{
      const snapshot=await tx.get('snapshot'),c=await tx.get('case:'+caseId);
      const key=`package:${caseId}:${manifest.id}`;
      if(!snapshot||!c||c.status==='canceled'||c.submission||c.reviewLockedAt||c.reviewHash!==manifest.reviewHash||versionOf(snapshot.versions,caseId)!==expectedVersion||await tx.get(key)) return response({error:'case changed or immutable package already exists'},409);
      const ids=await tx.get('package-index:'+caseId)||[];
      if(ids.length>=100) return response({error:'package history limit reached'},409);
      const chunkSize=65536,chunkCount=Math.ceil(encrypted.ciphertext.length/chunkSize);
      for(let i=0;i<chunkCount;i++) await tx.put(`${key}:${i}`,encrypted.ciphertext.slice(i*chunkSize,(i+1)*chunkSize));
      await tx.put(key,{manifest,encryption:{version:encrypted.version,iv:encrypted.iv},chunkCount});
      await tx.put('package-index:'+caseId,[...ids,manifest.id]);
      c.preparedPackage=manifest;delete c.aiReview;
      await tx.put('case:'+caseId,c);
      const revision=snapshot.revision+1;snapshot.versions[caseId]=revision;
      await tx.put('snapshot',{...snapshot,revision});
      return response({revision,manifest});
    });
  }

  async removePackages(tx,caseId) {
    const ids=await tx.get('package-index:'+caseId)||[];
    for(const id of ids) {
      const key=`package:${caseId}:${id}`,meta=await tx.get(key);
      for(let i=0;i<(meta?.chunkCount||0);i++) await tx.delete(`${key}:${i}`);
      await tx.delete(key);
    }
    await tx.delete('package-index:'+caseId);
  }
}

export default {fetch:()=>new Response('Not found',{status:404})};
