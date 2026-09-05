import test from 'node:test';
import assert from 'node:assert/strict';
import {indexHoaDocument} from '../functions/lib/hoa-document-index.js';

const sha256='a'.repeat(64);
const page=n=>({slug:`inbox/hoa-documents/${sha256}/page-${n}`,content:`---\ntitle: "Rules - Page ${n}"\ntype: document\nreview_status: unreviewed-source\ntags: [hoa, source-document, unreviewed]\n---\n\nOriginal SHA-256: ${sha256}\n\nPage ${n}; extraction: pdf-text.\n\n## Extracted source text\n\nExample rule ${n}.`});
const document=()=>({sha256,pageCount:2,knowledgePages:[page(1),page(2)]});
function fixture() {
  const pages=new Map(), writes=[], receipts=[];
  const destination={
    async read(slug){return pages.get(slug)??null;},
    async put(p){writes.push(p.slug); pages.set(p.slug,{id:writes.length,slug:p.slug,type:'document',title:JSON.parse(p.content.match(/^title: (.+)$/m)[1]),compiled_truth:p.content.split('\n---\n')[1].trim(),timeline:'',frontmatter:{review_status:'unreviewed-source'},tags:['hoa','source-document','unreviewed'],content_hash:'b'.repeat(64),deleted_at:null});},
    async chunks(slug){return [{id:100+pages.get(slug).id,page_id:pages.get(slug).id,chunk_index:0,chunk_source:'compiled_truth',chunk_text:pages.get(slug).compiled_truth,embedding_is_null:false,embedded_at:'2026-09-05T12:00:00.000Z',model:'example-embedding'}];}
  };
  return {pages,writes,receipts,destination,options:{document:document(),destination,onVerified:async r=>receipts.push(r),now:()=>new Date('2026-09-05T13:00:00Z')}};
}
test('indexes every page and verifies content and embeddings before issuing document receipt',async()=>{
  const f=fixture(), r=await indexHoaDocument(f.options);
  assert.equal(r.sha256,sha256); assert.equal(r.indexStatus,'verified'); assert.equal(r.pages.length,2);
  assert.equal(f.receipts.length,2); assert.equal(r.reviewStatus,'unreviewed-source');
  assert.equal(r.pages[0].allEmbeddingsPresent,true); assert.equal(r.pages[0].exactBodyVerified,true);
});
test('a resumed import rechecks destination and never rewrites identical pages',async()=>{
  const f=fixture(); await indexHoaDocument(f.options); await indexHoaDocument(f.options);
  assert.equal(f.writes.length,2); assert.equal(f.receipts.length,4);
});
test('all pages and hash-addressed slugs are validated before any outbound operation',async()=>{
  for(const mutate of [d=>d.knowledgePages.pop(),d=>d.knowledgePages[1].slug='canon/rules',d=>d.knowledgePages[1]=page(1),d=>d.pageCount=301,d=>d.knowledgePages[1].content=d.knowledgePages[1].content.replace(sha256,'c'.repeat(64)),d=>d.knowledgePages[1].content=d.knowledgePages[1].content.replace('unreviewed-source','approved')]) {
    const f=fixture(); mutate(f.options.document);
    await assert.rejects(indexHoaDocument(f.options),{code:'HOA_INDEX_INPUT'}); assert.equal(f.writes.length,0);
  }
});
test('existing different text or metadata and tombstones are never overwritten',async()=>{
  for(const mutate of [p=>p.compiled_truth+=' changed',p=>p.frontmatter.review_status='approved',p=>p.deleted_at='2026-09-05T12:00:00Z',p=>p.timeline='owner notes']) {
    const f=fixture(); await f.destination.put(page(1)); mutate(f.pages.get(page(1).slug));
    await assert.rejects(indexHoaDocument(f.options),{code:'HOA_INDEX_CONFLICT'}); assert.equal(f.writes.length,1);
  }
});
test('read errors are not absence and do not cause a write',async()=>{
  const f=fixture(); f.destination.read=async()=>{throw Error('private connection detail');};
  await assert.rejects(indexHoaDocument(f.options),{code:'HOA_INDEX_UNAVAILABLE',message:'HOA document destination is unavailable'});
  assert.equal(f.writes.length,0);
});
test('an uncertain write is accepted only after exact readback and embedding confirmation',async()=>{
  const f=fixture(), put=f.destination.put;
  f.destination.put=async p=>{await put(p);throw Error('timeout after commit');};
  assert.equal((await indexHoaDocument(f.options)).indexStatus,'verified'); assert.equal(f.writes.length,2);
});
test('an uncommitted write timeout remains pending and is never blindly replayed',async()=>{
  const f=fixture(); let attempts=0; f.destination.put=async()=>{attempts++;throw Error('timeout');};
  await assert.rejects(indexHoaDocument(f.options),{code:'HOA_INDEX_UNCONFIRMED'});
  assert.equal(attempts,1); assert.equal(f.receipts.length,0);
});
test('missing vectors, wrong page chunks, stale or missing chunks never confirm a page',async()=>{
  for(const mutate of [c=>c[0].embedding_is_null=true,c=>delete c[0].embedding_is_null,c=>c[0].page_id=999,c=>c[0].chunk_text='stale text',c=>c[0].embedded_at=null,c=>c.splice(0)]) {
    const f=fixture(), chunks=f.destination.chunks; f.destination.chunks=async slug=>{const c=await chunks(slug);mutate(c);return c;};
    await assert.rejects(indexHoaDocument(f.options),{code:'HOA_INDEX_EMBEDDINGS_PENDING'});assert.equal(f.receipts.length,0);
  }
});
test('post-write readback mismatch does not create a successful receipt',async()=>{
  const f=fixture(), put=f.destination.put;f.destination.put=async p=>{await put(p);f.pages.get(p.slug).compiled_truth='truncated';};
  await assert.rejects(indexHoaDocument(f.options),{code:'HOA_INDEX_UNCONFIRMED'}); assert.equal(f.receipts.length,0);
});
test('partial chunk coverage cannot masquerade as a fully indexed page',async()=>{
  const f=fixture(), chunks=f.destination.chunks;
  f.destination.chunks=async slug=>{const c=await chunks(slug);c[0].chunk_text=c[0].chunk_text.split('\n\n')[0];return c;};
  await assert.rejects(indexHoaDocument(f.options),{code:'HOA_INDEX_EMBEDDINGS_PENDING'}); assert.equal(f.receipts.length,0);
});
test('ordered overlapping chunks can cover the complete source body',async()=>{
  const f=fixture(), chunks=f.destination.chunks;
  f.destination.chunks=async slug=>{const [c]=await chunks(slug), text=c.chunk_text.replace(/\s+/g,' ').trim(), middle=Math.floor(text.length/2);return [{...c,chunk_text:text.slice(0,middle+20)},{...c,id:c.id+1000,chunk_index:1,chunk_text:text.slice(middle)}];};
  assert.equal((await indexHoaDocument(f.options)).pages[0].chunkCount,2);
});
test('receipt storage failure stops before the next page; retry verifies committed page',async()=>{
  const f=fixture(); f.options.onVerified=async()=>{throw Error('disk unavailable');};
  await assert.rejects(indexHoaDocument(f.options),{code:'HOA_INDEX_RECEIPT_FAILED'}); assert.equal(f.writes.length,1);
  f.options.onVerified=async r=>f.receipts.push(r); await indexHoaDocument(f.options); assert.equal(f.writes.length,2);
});
test('a later page failure preserves earlier confirmed progress but never confirms the document',async()=>{
  const f=fixture(), chunks=f.destination.chunks; f.destination.chunks=async slug=>slug.endsWith('page-2')?[]:chunks(slug);
  await assert.rejects(indexHoaDocument(f.options),{code:'HOA_INDEX_EMBEDDINGS_PENDING'}); assert.equal(f.receipts.length,1);
});
