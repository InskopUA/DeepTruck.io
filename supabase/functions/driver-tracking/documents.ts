import type { SupabaseClient, User } from 'npm:@supabase/supabase-js@2.117.2';
import { HttpError, text, uuid } from './validation.ts';

export type DocumentContext = {
  db: SupabaseClient; serviceKey: string;
  json: (data: unknown, status?: number) => Response;
  databaseError: (error: {code?: string; message: string} | null) => void;
  requireDealer: (user: User) => void;
  driverPhone: (user: User) => string;
};
const bucket = 'pickup-documents', maxBytes = 10 * 1024 * 1024;
const encode = (bytes: Uint8Array) => btoa(Array.from(bytes, b => String.fromCharCode(b)).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c => c.charCodeAt(0));
async function signingKey(secret: string) {
  return crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
type Ticket = {actor:string;load:string;document:string;driver:boolean;expires:number};
async function signTicket(value: Ticket, secret: string) {
  const payload = encode(new TextEncoder().encode(JSON.stringify(value)));
  const signature = await crypto.subtle.sign('HMAC',await signingKey(secret),new TextEncoder().encode(payload));
  return payload+'.'+encode(new Uint8Array(signature));
}
async function verifyTicket(raw: string, secret: string): Promise<Ticket> {
  try {
    if (raw.length>1500) throw new Error();
    const [payload,signature,extra] = raw.split('.');
    if (!payload || !signature || extra || !await crypto.subtle.verify('HMAC',await signingKey(secret),decode(signature),new TextEncoder().encode(payload))) throw new Error();
    const value = JSON.parse(new TextDecoder().decode(decode(payload)));
    uuid(value.actor); uuid(value.load); uuid(value.document);
    if (typeof value.driver!=='boolean' || !Number.isFinite(value.expires) || value.expires<=Date.now() || value.expires>Date.now()+121000) throw new Error();
    return value;
  } catch { throw new HttpError(403,'Document link expired. Open the document again.'); }
}
async function access(ctx: DocumentContext, value: Ticket, opened = false) {
  const {data,error} = await ctx.db.rpc('tracking_document_access',{p_actor:value.actor,p_phone:'',p_load:value.load,p_document:value.document,p_driver:value.driver,p_opened:opened});
  ctx.databaseError(error); return data;
}
export async function documentViewer(req: Request, ctx: DocumentContext): Promise<Response> {
  const ticket = await verifyTicket(new URL(req.url).searchParams.get('ticket') || '',ctx.serviceKey);
  const file = await access(ctx,ticket);
  const {data,error} = await ctx.db.storage.from(bucket).download(file.object_path);
  if (error || !data) throw new HttpError(503,'Unable to open this document. Please try again.');
  // Recheck after storage retrieval, and record Opened only when serving bytes.
  await access(ctx,ticket,true);
  return new Response(data,{headers:{
    'Content-Type':file.mime_type,
    'Content-Disposition':`inline; filename="pickup-document.${file.mime_type==='application/pdf'?'pdf':file.mime_type==='image/png'?'png':'jpg'}"; filename*=UTF-8''${encodeURIComponent(file.file_name)}`,
    'Cache-Control':'private, no-store, max-age=0','Referrer-Policy':'no-referrer',
    'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",
  }});
}
export async function decorateDocuments(user: User, loads: Record<string, any>[], driver: boolean, ctx: DocumentContext) {
  const configured = loads.filter(v=>v.pickup_latitude!==null && v.pickup_latitude!==undefined);
  let states: Record<string, unknown> = {};
  if (configured.length) {
    const {data,error} = await ctx.db.rpc('tracking_document_states',{p_actor:user.id,p_phone:driver?ctx.driverPhone(user):'',p_loads:configured.map(v=>v.id),p_driver:driver});
    ctx.databaseError(error); states=data || {};
  }
  return loads.map(v=>({
    pickupLocation:v.pickup_latitude===null || v.pickup_latitude===undefined ? null : {latitude:v.pickup_latitude,longitude:v.pickup_longitude,radiusMiles:1},
    pickupDocuments:states[v.id] || {documents:[],unlockedAt:null,unlockMethod:null,status:'locked',canOpen:false},
  }));
}
async function limitedForm(req: Request) {
  // Bound the multipart body even when Content-Length is absent or forged.
  if (!req.headers.get('Content-Type')?.startsWith('multipart/form-data;')) throw new HttpError(400,'Choose a PDF, JPG or PNG file.');
  const reader=req.body?.getReader(); if (!reader) throw new HttpError(400,'Choose a document.');
  const chunks: Uint8Array[]=[]; let size=0;
  try {
    while (true) {const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes+16384){await reader.cancel();throw new HttpError(413,'Each document must be 10 MB or smaller.');}chunks.push(value);}
    return await new Response(new Blob(chunks as BlobPart[]),{headers:{'Content-Type':req.headers.get('Content-Type')!}}).formData();
  } catch (e) {if(e instanceof HttpError)throw e;throw new HttpError(400,'Invalid document upload.');}
}
function fileType(bytes: Uint8Array) {
  if (bytes.length>=5 && new TextDecoder().decode(bytes.subarray(0,5))==='%PDF-') return {mime:'application/pdf',extension:'pdf'};
  if (bytes.length>=8 && [137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)) return {mime:'image/png',extension:'png'};
  if (bytes.length>=3 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255) return {mime:'image/jpeg',extension:'jpg'};
  throw new HttpError(400,'Choose a valid PDF, JPG or PNG document.');
}
export async function documentRoutes(req: Request,path: string,user: User,ctx: DocumentContext): Promise<Response | null> {
  const unlock=path.match(/^\/loads\/([^/]+)\/documents\/unlock$/);
  if (unlock && req.method==='POST') {
    ctx.requireDealer(user);
    const {data,error}=await ctx.db.rpc('tracking_unlock_documents',{p_shipper:user.id,p_load:uuid(unlock[1])});
    ctx.databaseError(error);return ctx.json({pickupDocuments:data});
  }
  const driver = path.startsWith('/driver/');
  const match=path.match(/^\/(?:driver\/)?loads\/([^/]+)\/(pickup|documents(?:\/([^/]+)\/(open))?)$/);
  if (!match || req.method!=='POST') return null;
  if (driver) ctx.driverPhone(user); else ctx.requireDealer(user);
  const id=uuid(match[1]), action=match[2];
  if (!driver && action==='pickup') {
    const raw=await req.text(); if(raw.length>3000)throw new HttpError(413,'Request is too large.');
    let input;try{input=JSON.parse(raw);}catch{throw new HttpError(400,'Invalid pickup location.');}
    if (!input || input.confirmed!==true || typeof input.latitude!=='number' || typeof input.longitude!=='number' || !Number.isFinite(input.latitude) || !Number.isFinite(input.longitude)) throw new HttpError(400,'Confirm the exact pickup address and map pin.');
    const {error}=await ctx.db.rpc('tracking_pickup',{p_shipper:user.id,p_load:id,p_address:text(input.address,'pickup address',500),p_latitude:input.latitude,p_longitude:input.longitude});
    ctx.databaseError(error);return ctx.json({saved:true});
  }
  if (!driver && action==='documents') {
    // Authorize before reading a potentially large request body.
    const {data:load,error:loadError}=await ctx.db.from('tracking_loads').select('*').eq('id',id).eq('shipper_user_id',user.id).maybeSingle();
    ctx.databaseError(loadError);if(!load)throw new HttpError(404,'Load not found.');
    if (['completed','cancelled','declined'].includes(load.status) || Date.parse(load.expires_at)<=Date.now()) throw new HttpError(400,'This load is closed.');
    if(load.pickup_latitude===null)throw new HttpError(400,'Confirm the pickup location before uploading documents.');
    const form=await limitedForm(req),file=form.get('file');
    if (!(file instanceof File) || !file.size || file.size>maxBytes) throw new HttpError(400,'Each document must be between 1 byte and 10 MB.');
    const document=uuid(form.get('id'),'document ID'),kind=form.get('kind');
    if(kind!=='gate_pass' && kind!=='release_form')throw new HttpError(400,'Choose Gate pass or Release form.');
    const name=text(file.name.replace(/[\u0000-\u001f\u007f/\\]/g,'_'),'file name',180);
    const bytes=new Uint8Array(await file.arrayBuffer()),type=fileType(bytes);
    if(file.type && file.type!==type.mime && file.type!=='application/octet-stream')throw new HttpError(400,'The file content does not match its format.');
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    const objectPath=`${id}/${document}/${digest}.${type.extension}`;
    // Hash-addressed bytes make retrying this exact file safe without replacing
    // the content of an existing document with different bytes.
    const {error:uploadError}=await ctx.db.storage.from(bucket).upload(objectPath,bytes,{contentType:type.mime,upsert:false});
    const duplicate=uploadError && (uploadError.message==='The resource already exists' || (uploadError as {statusCode?:string}).statusCode==='409' || (uploadError as {error?:string}).error==='Duplicate');
    if(uploadError && !duplicate)throw new HttpError(503,'Unable to upload this document. Please try again.');
    const {error}=await ctx.db.rpc('tracking_add_document',{p_shipper:user.id,p_load:id,p_document:document,p_name:name,p_kind:kind,p_mime:type.mime,p_size:file.size,p_path:objectPath});
    if(error && !uploadError) await ctx.db.storage.from(bucket).remove([objectPath]);
    ctx.databaseError(error);return ctx.json({saved:true,id:document},201);
  }
  if (match[4]==='open') {
    const ticket: Ticket={actor:user.id,load:id,document:uuid(match[3]),driver,expires:Date.now()+120000};
    await access(ctx,ticket);
    const origin=Deno.env.get('TRACKING_PUBLIC_API_URL') || Deno.env.get('SUPABASE_URL')+'/functions/v1/driver-tracking';
    return ctx.json({url:origin+'/documents/view?ticket='+await signTicket(ticket,ctx.serviceKey)});
  }
  return null;
}
