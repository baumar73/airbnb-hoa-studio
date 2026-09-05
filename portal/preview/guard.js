// Imported only by the separately built owner-only acceptance preview.
// Never install this wrapper in the production Pages build.
const HEADERS={'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow, noarchive','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'};
const reply=(text,status)=>new Response(text,{status,headers:HEADERS});
export function previewEnvironment(env) {
  if(env.PREVIEW_ONLY!=='yes'||!env.PREVIEW_CASES||!env.PREVIEW_CASE_STORE)throw Error('Preview configuration unavailable');
  return {CASES:env.PREVIEW_CASES,CASE_STORE:env.PREVIEW_CASE_STORE,ASSETS:env.ASSETS,
    ADMIN_USER:env.PREVIEW_USER,ADMIN_PASSWORD:env.PREVIEW_PASSWORD,
    DATA_ENCRYPTION_KEY:env.PREVIEW_DATA_ENCRYPTION_KEY,AUDIT_HASH_SALT:env.PREVIEW_AUDIT_SALT,FIND_RATE_SALT:env.PREVIEW_AUDIT_SALT,
    PORTAL_ORIGIN:'https://'+env.PREVIEW_HOST,REQUIRE_ATOMIC_CASES:'yes',AUTO_HOA_SUBMIT:'no',AUTO_GUEST_REMINDERS:'no',
    AIRBNB_RELAY_CAPTURE:'no',AIRBNB_RELAY_REMINDERS:'no',REMINDER_DELIVERY_MONITOR:'no',REVIEW_RELIABILITY:'no'};
}
const digest=async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
async function authenticated(request,env) {
  if(typeof env.PREVIEW_PASSWORD!=='string'||env.PREVIEW_PASSWORD.length<32||!env.PREVIEW_USER)return false;
  const [a,b]=await Promise.all([digest(request.headers.get('Authorization')||''),digest('Basic '+btoa(env.PREVIEW_USER+':'+env.PREVIEW_PASSWORD))]);
  let difference=0;for(let i=0;i<a.length;i++)difference|=a[i]^b[i];return difference===0;
}
function allowed(path,method) {
  if(['GET','HEAD'].includes(method))return ['/', '/healthz','/automation-healthz','/admin','/admin/cases','/admin/automation-health','/privacy','/fair-housing','/__preview/state'].includes(path)||/^\/(v|w)\/[A-Za-z0-9_-]{6,}(\/(brief\.txt|pdf\/[a-z-]+))?$/.test(path)||/^\/(forms|photos)\/[A-Za-z0-9_.-]+$/.test(path);
  if(method!=='POST')return false;
  return ['/admin/create','/admin/toggle','/__preview/initialize','/__preview/cancel'].includes(path)||/^\/w\/[A-Za-z0-9_-]{6,}(\/(route|occupancy))?$/.test(path)||/^\/v\/[A-Za-z0-9_-]{6,}\/(screening-reported|hoa-task-reported|reminder-contact)$/.test(path);
}
export async function previewRequest(request,env,dispatch) {
  const url=new URL(request.url);
  if(env.PREVIEW_ONLY!=='yes')return reply('Preview not configured',503);
  if(url.protocol!=='https:'||url.hostname!==env.PREVIEW_HOST||url.port)return reply('Preview host only',403);
  if(!await authenticated(request,env))return new Response('Owner-only acceptance preview',{status:401,headers:{...HEADERS,'WWW-Authenticate':'Basic realm="HOA acceptance preview"'}});
  if(!allowed(url.pathname,request.method)||request.method==='POST'&&request.headers.get('Origin')!==url.origin)return reply('Disabled in acceptance preview',403);
  try {
    const response=await dispatch(request,previewEnvironment(env));
    const location=response.headers.get('Location');
    if(location&&new URL(location,url).origin!==url.origin)return reply('External redirect disabled in acceptance preview',403);
    const headers=new Headers(response.headers);for(const [k,v] of Object.entries(HEADERS))headers.set(k,v);
    if(headers.get('Content-Type')?.includes('text/html')) {
      headers.delete('Content-Length');headers.delete('ETag');
      const body=(await response.text()).replace(/<body([^>]*)>/i,'<body$1><div id="preview-external-disabled" style="background:#fff0b3;color:#222;padding:16px;font:16px sans-serif"><b>TEST ONLY — synthetic guests. No messages, payments or HOA submissions.</b></div>').replace(/href=(['"])(?:https?:)?\/\/[^'"\s]+\1/gi,'href="#preview-external-disabled"');
      return new Response(request.method==='HEAD'?null:body,{status:response.status,headers});
    }
    return new Response(request.method==='HEAD'?null:response.body,{status:response.status,headers});
  }catch{return reply('Acceptance preview temporarily unavailable',503);}
}
