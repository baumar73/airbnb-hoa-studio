// Verified, restart-safe importer core for private HOA source documents.
// No runtime connection or scheduler is installed by importing this module.
// The trusted adapter must map ONLY confirmed page_not_found to null (including
// tombstones in reads), enforce bounded requests, and serialize writers for this
// namespace. onVerified must durably store the page receipt before resolving.
const HASH=/^[a-f0-9]{64}$/;
const TAGS=['hoa','source-document','unreviewed'];
function fail(code,message='HOA document indexing requires reconciliation') {
  throw Object.assign(new Error(message),{code});
}
function prepare(document) {
  if(!document||!HASH.test(document.sha256)||!Number.isSafeInteger(document.pageCount)||document.pageCount<1||document.pageCount>300||!Array.isArray(document.knowledgePages)||document.knowledgePages.length!==document.pageCount) fail('HOA_INDEX_INPUT');
  return document.knowledgePages.map((p,i)=>{
    const number=i+1;
    if(!p||p.slug!==`inbox/hoa-documents/${document.sha256}/page-${number}`||typeof p.content!=='string'||p.content.length>200000) fail('HOA_INDEX_INPUT');
    // Accept only the archive script's narrow envelope, not arbitrary YAML or
    // model-authored destination instructions. Source text remains plain data.
    const match=p.content.match(/^---\ntitle: ("[^\n]*")\ntype: document\nreview_status: unreviewed-source\ntags: \[hoa, source-document, unreviewed\]\n---\n\n([\s\S]+)$/);
    if(!match) fail('HOA_INDEX_INPUT');
    let title;try{title=JSON.parse(match[1]);}catch{fail('HOA_INDEX_INPUT');}
    const body=match[2].trim();
    if(typeof title!=='string'||!title.trim()||title.length>600||!body.includes(`Original SHA-256: ${document.sha256}\n\n`)||!body.includes(`Page ${number}; extraction: `)||!body.split('## Extracted source text\n\n')[1]?.trim()) fail('HOA_INDEX_INPUT');
    return {slug:p.slug,content:p.content,title,body};
  });
}
function exact(page,expected) {
  return page&&page.slug===expected.slug&&Number.isSafeInteger(page.id)&&page.id>0&&!page.deleted_at&&page.type==='document'&&page.title===expected.title&&page.compiled_truth===expected.body&&!page.timeline&&page.frontmatter?.review_status==='unreviewed-source'&&TAGS.every(t=>page.tags?.includes(t))&&HASH.test(page.content_hash);
}
async function read(destination,slug) {
  try{return await destination.read(slug);}
  catch{fail('HOA_INDEX_UNAVAILABLE','HOA document destination is unavailable');}
}
function verifyChunks(chunks,page) {
  const normalize=s=>s.replace(/\s+/g,' ').trim();
  const body=normalize(page.compiled_truth);
  if(!Array.isArray(chunks)||!chunks.length||chunks.length>10000) fail('HOA_INDEX_EMBEDDINGS_PENDING');
  const sorted=[...chunks].sort((a,b)=>a.chunk_index-b.chunk_index), ids=new Set();
  let covered=0;
  for(const [i,c] of sorted.entries()) {
    if(!c||!Number.isSafeInteger(c.id)||c.id<1||ids.has(c.id)||c.page_id!==page.id||c.chunk_index!==i||c.chunk_source!=='compiled_truth'||typeof c.chunk_text!=='string'||!c.chunk_text.trim()||!body.includes(normalize(c.chunk_text))||c.embedding_is_null!==false||typeof c.embedded_at!=='string'||!Number.isFinite(Date.parse(c.embedded_at))||typeof c.model!=='string'||!c.model) fail('HOA_INDEX_EMBEDDINGS_PENDING');
    ids.add(c.id);
    const text=normalize(c.chunk_text);
    const start=body.indexOf(text,Math.max(0,covered-text.length));
    if(start<0||start>covered+Number(covered>0)||start+text.length<=covered) fail('HOA_INDEX_EMBEDDINGS_PENDING');
    covered=start+text.length;
  }
  if(covered!==body.length) fail('HOA_INDEX_EMBEDDINGS_PENDING');
  return sorted;
}

export async function indexHoaDocument({document,destination,onVerified,now=()=>new Date()}) {
  if(!destination||!['read','put','chunks'].every(k=>typeof destination[k]==='function')||typeof onVerified!=='function'||typeof now!=='function') fail('HOA_INDEX_CONTRACT');
  // Preflight the entire document before the first external call. Empty pages
  // and missing page payloads require review, not a partial success receipt.
  const prepared=prepare(document), pages=[];
  for(const expected of prepared) {
    const before=await read(destination,expected.slug);
    if(before!==null&&!exact(before,expected)) fail('HOA_INDEX_CONFLICT');
    let action='verified-existing';
    if(before===null) {
      action='created';
      try{await destination.put({slug:expected.slug,content:expected.content});}
      catch{action='confirmed-after-error';}
    }
    // Even an apparently successful write or a saved local checkpoint is not
    // evidence of an exact destination outcome. Never blindly replay a timeout.
    const after=await read(destination,expected.slug);
    if(!exact(after,expected)) fail('HOA_INDEX_UNCONFIRMED');
    let raw;try{raw=await destination.chunks(expected.slug);}catch{fail('HOA_INDEX_UNAVAILABLE','HOA document destination is unavailable');}
    const chunks=verifyChunks(raw,after), at=now();
    if(!(at instanceof Date)||!Number.isFinite(at.getTime())) fail('HOA_INDEX_CLOCK');
    const receipt={slug:expected.slug,action,contentHash:after.content_hash,chunkCount:chunks.length,chunkIds:chunks.map(c=>c.id),embeddingModels:[...new Set(chunks.map(c=>c.model))],verifiedAt:at.toISOString(),exactBodyVerified:true,allEmbeddingsPresent:true};
    try{await onVerified(structuredClone(receipt));}catch{fail('HOA_INDEX_RECEIPT_FAILED');}
    pages.push(receipt);
  }
  // A source-document receipt is not evidence of a complete remote inventory,
  // a legal rule's validity, or a guest/HOA approval.
  return {protocol:1,sha256:document.sha256,indexStatus:'verified',reviewStatus:'unreviewed-source',pageCount:prepared.length,pages};
}
