import type {User} from 'npm:@supabase/supabase-js@2.117.2';
import {HttpError,uuid} from './validation.ts';
import {fileType,limitedForm,viewerLink,type DocumentContext,type Ticket} from './documents.ts';
import {damageRecords,DAMAGE_CATALOG_VERSION} from '../_shared/damage-codes.ts';
import {gatePassLayout,annotatedGatePass,type GatePassLayout} from './inspection-pdf.ts';

const photosBucket='inspection-photos';
const escape=(value:unknown)=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const site=()=>Deno.env.get('VERIFY_APP_URL') || 'https://www.deeptruck.io';
const apiOrigin=()=>Deno.env.get('TRACKING_PUBLIC_API_URL') || Deno.env.get('SUPABASE_URL')+'/functions/v1/driver-tracking';
const photoLink=(key:string,id:string)=>`${site()}/i/${key}/photo/${id}`;
const shareLink=(key:string)=>`${site()}/i/${key}`;
async function rpc(ctx:DocumentContext,name:string,args:Record<string,unknown>){const {data,error}=await ctx.db.rpc(name,args);ctx.databaseError(error);return data;}
async function fileAccess(ctx:DocumentContext,user:User,load:string,document:string,driver:boolean){
  return rpc(ctx,'tracking_document_access',{p_actor:user.id,p_phone:'',p_load:load,p_document:document,p_driver:driver,p_opened:false});
}
async function read(ctx:DocumentContext,user:User,load:string,document:string,driver:boolean){return rpc(ctx,'pickup_inspection_read',{p_actor:user.id,p_load:load,p_document:document,p_driver:driver});}
async function original(ctx:DocumentContext,file:Record<string,any>){
  const {data,error}=await ctx.db.storage.from('pickup-documents').download(file.object_path);
  if(error || !data)throw new HttpError(503,'Unable to read this gate pass. Please try again.');return new Uint8Array(await data.arrayBuffer());
}
async function input(req:Request){const raw=await req.text();if(raw.length>40000)throw new HttpError(413,'Inspection is too large.');try{const value=JSON.parse(raw);if(!value || typeof value!=='object' || Array.isArray(value))throw new Error();return value;}catch{throw new HttpError(400,'Invalid inspection.');}}
async function publicInspection(i:Record<string,any>|null,ctx:DocumentContext,user:User,load:string,document:string,driver:boolean){
  if(!i)return null;
  return {id:i.id,status:i.status,revision:i.revision,damages:i.damages,noDamageObserved:i.no_damage_observed,createdAt:i.created_at,savedAt:i.saved_at,completedAt:i.completed_at,catalogVersion:i.catalog_version,
    shareUrl:i.status==='completed'?shareLink(i.share_key):null,
    photos:await Promise.all((i.photos || []).map(async(p:Record<string,any>)=>({id:p.id,damageId:p.damage_id,mimeType:p.mime_type,size:p.byte_size,url:i.status==='completed'?photoLink(i.share_key,p.id):await viewerLink({actor:user.id,load,document,driver,expires:Date.now()+120000,kind:'photo',photo:p.id},ctx)})))};
}
export async function inspectionRoutes(req:Request,path:string,user:User,ctx:DocumentContext):Promise<Response|null>{
  const match=path.match(/^\/(driver\/)?loads\/([^/]+)\/documents\/([^/]+)\/inspection(?:\/(photos|preview|finish|open))?$/);
  if(!match)return null;
  const driver=Boolean(match[1]),load=uuid(match[2]),document=uuid(match[3]),action=match[4];
  if(driver)ctx.driverPhone(user);else ctx.requireDealer(user);
  const file=await fileAccess(ctx,user,load,document,driver);
  if(file.kind!=='gate_pass')throw new HttpError(400,'Choose a gate pass for this vehicle.');
  const i=await read(ctx,user,load,document,driver);
  if(req.method==='GET' && !action){
    return ctx.json({inspection:await publicInspection(i,ctx,user,load,document,driver),serverNow:new Date().toISOString()});
  }
  if(req.method==='POST' && action==='open'){
    if(!i?.annotated_path || i.preview_revision!==i.revision)throw new HttpError(400,'Review or finish the inspection to generate this gate pass.');
    return ctx.json({url:await viewerLink({actor:user.id,load,document,driver,expires:Date.now()+120000,kind:'annotated',revision:i.revision},ctx)});
  }
  if(!driver || req.method!=='POST')return null;
  if(!action){
    const body=await input(req);
    let damages;try{damages=damageRecords(body.damages);}catch(e){throw new HttpError(400,(e as Error).message);}
    if(!Number.isInteger(body.revision) || body.revision<0)throw new HttpError(400,'Invalid inspection version.');
    const layout:GatePassLayout=i?.pdf_layout || await gatePassLayout(await original(ctx,file),file.mime_type);
    const key=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    const saved=await rpc(ctx,'pickup_inspection_save',{p_actor:user.id,p_load:load,p_document:document,p_id:uuid(body.id,'inspection ID'),p_damages:damages,p_revision:body.revision,p_layout:layout,p_share_key:key,p_catalog:DAMAGE_CATALOG_VERSION});
    return ctx.json({inspection:await publicInspection(saved,ctx,user,load,document,true)});
  }
  if(action==='photos'){
    if(!i || i.status!=='draft')throw new HttpError(400,'Start an inspection before adding photos.');
    const form=await limitedForm(req),photo=form.get('file');if(!(photo instanceof File) || !photo.size)throw new HttpError(400,'Choose a damage photo.');
    const id=uuid(form.get('id'),'photo ID'),damage=uuid(form.get('damageId'),'damage ID');
    if(!i.damages.some((d:{id:string})=>d.id===damage))throw new HttpError(400,'Save this damage before adding its photo.');
    const bytes=new Uint8Array(await photo.arrayBuffer()),type=fileType(bytes);if(type.mime==='application/pdf')throw new HttpError(400,'Use a JPG or PNG photo.');
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join(''),path=`${i.id}/${damage}/${id}/${hash}.${type.extension}`;
    const {error}=await ctx.db.storage.from(photosBucket).upload(path,bytes,{contentType:type.mime,upsert:false});
    if(error && error.message!=='The resource already exists')throw new HttpError(503,'Unable to upload this photo. Please try again.');
    try{
      const saved=await rpc(ctx,'pickup_inspection_add_photo',{p_actor:user.id,p_load:load,p_document:document,p_photo:id,p_damage:damage,p_path:path,p_mime:type.mime,p_size:photo.size});
      return ctx.json({inspection:await publicInspection(saved,ctx,user,load,document,true)});
    }catch(e){if(!error)await ctx.db.storage.from(photosBucket).remove([path]);throw e;}
  }
  if(action==='preview' || action==='finish'){
    if(!i)throw new HttpError(400,'Start an inspection first.');
    if(i.status==='completed')return ctx.json({inspection:await publicInspection(i,ctx,user,load,document,true),url:await viewerLink({actor:user.id,load,document,driver,expires:Date.now()+120000,kind:'annotated',revision:i.revision},ctx)});
    const body=await input(req);if(body.revision!==i.revision)throw new HttpError(400,'Inspection changed. Review it again.');
    if(!i.damages.length && body.noDamageObserved!==true)throw new HttpError(400,'Record damages or select No visible damage observed.');
    if(i.damages.some((d:{id:string})=>!i.photos.some((p:{damage_id:string})=>p.damage_id===d.id)))throw new HttpError(400,'Add a photo for each recorded damage.');
    const bytes=await annotatedGatePass(await original(ctx,file),file.mime_type,i.pdf_layout,i.damages,shareLink(i.share_key),i.saved_at);
    const path=`${load}/${document}/inspection/${i.id}/v${i.revision}/gate-pass.pdf`;
    const {error}=await ctx.db.storage.from('pickup-documents').upload(path,bytes,{contentType:'application/pdf',upsert:false});
    if(error && error.message!=='The resource already exists')throw new HttpError(503,'Unable to save the gate pass. Please try again.');
    const saved=await rpc(ctx,'pickup_inspection_publish',{p_actor:user.id,p_load:load,p_document:document,p_revision:i.revision,p_path:path,p_finish:action==='finish',p_no_damage:body.noDamageObserved===true});
    return ctx.json({inspection:await publicInspection(saved,ctx,user,load,document,true),url:await viewerLink({actor:user.id,load,document,driver,expires:Date.now()+120000,kind:'annotated',revision:saved.revision},ctx)});
  }
  return null;
}
export async function inspectionGallery(req:Request,path:string,ctx:DocumentContext):Promise<Response|null>{
  const match=path.match(/^\/inspection\/photos\/([A-Za-z0-9_-]{22})(?:\/photo\/([^/]+))?$/);if(!match || req.method!=='GET')return null;
  const key=match[1],photo=match[2]?uuid(match[2],'photo ID'):null;
  let data;try{data=await rpc(ctx,'pickup_inspection_gallery',{p_key:key,p_photo:photo});}catch(e){if(e instanceof HttpError && e.status===403)throw new HttpError(404,'Inspection not found.');throw e;}
  const headers={'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow, noarchive','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
  if(photo){const {data:file,error}=await ctx.db.storage.from(photosBucket).download(data.object_path);if(error || !file)throw new HttpError(503,'Photo temporarily unavailable.');return new Response(file,{headers:{...headers,'Content-Type':data.mime_type}});}
  const photoUrl=(id:string)=>apiOrigin()+`/inspection/photos/${key}/photo/${id}`;
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Damage photos · DeepTruck</title><style>body{margin:0;background:#f6f8fb;color:#202c3d;font:15px -apple-system,BlinkMacSystemFont,Inter,sans-serif}main{max-width:760px;margin:0 auto;padding:28px 20px}header{border-bottom:1px solid #e4eaf1;padding-bottom:20px}h1{font-size:26px;letter-spacing:-.8px;margin:24px 0 10px}h2{font-size:16px;margin:0 0 7px}p{color:#68788b;line-height:1.6}article{background:white;border:1px solid #e4eaf1;border-radius:12px;margin-top:16px;padding:18px}.code{font:600 18px ui-monospace,monospace;color:#286bc0}.photos{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-top:15px}img{width:100%;height:180px;object-fit:cover;border-radius:8px}.brand{font-size:20px;font-weight:650}.caption{font-size:12px}a{color:#286bc0}</style></head><body><main><header><span class="brand">DeepTruck</span><h1>Pickup damage photos</h1><p>Recorded by driver · ${escape(new Date(data.completedAt).toISOString().slice(0,16).replace('T',' '))} UTC</p></header>${data.damages.length?data.damages.map((d:Record<string,any>)=>`<article><h2>${escape(d.areaLabel)}</h2><span class="code">${escape(d.code)}</span><p>${escape(d.typeLabel)} · ${escape(d.sizeLabel)}</p><div class="photos">${data.photos.filter((p:{damageId:string})=>p.damageId===d.id).map((p:{id:string})=>`<a href="${escape(photoUrl(p.id))}" target="_blank" rel="noopener"><img src="${escape(photoUrl(p.id))}" alt="${escape(d.areaLabel+' — '+d.typeLabel)}" loading="lazy"></a>`).join('')}</div></article>`).join(''):'<article><p>No visible damage observed by driver.</p></article>'}<p class="caption">Damage notes and photos recorded by the driver for this vehicle.</p></main></body></html>`;
  return new Response(html,{headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; img-src 'self' https://*.supabase.co; style-src 'unsafe-inline'; frame-ancestors 'none'"}});
}
