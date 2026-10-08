import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID, createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { PGlite } from '@electric-sql/pglite';
import { fetchJson } from '../driver-app/src/http.ts';

test('Edge API: real SDK and SQL, verified driver login, ownership and scoped location',async t=>{
  const db=await PGlite.create();t.after(()=>db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.role() returns text language sql as $$select current_user::text$$;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid,bucket_id text);alter table storage.objects enable row level security;`);
  for(const file of ['20260911232000_carrier_verify.sql','20260912033000_add_w9_coi_documents.sql','20261003164500_add_shipper_user_to_verifications.sql','20261005180000_driver_tracking.sql','20261007180000_pickup_documents.sql','20261007200000_pickup_inspections.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
  const user=(kind,extra={})=>({id:randomUUID(),aud:'authenticated',role:'authenticated',email:kind==='dealer'?'dealer@example.com':null,email_confirmed_at:kind==='dealer'?new Date().toISOString():null,phone:kind==='driver'?'15551234567':null,phone_confirmed_at:kind==='driver'?new Date().toISOString():null,user_metadata:{company_name:'Test dealer'},app_metadata:{},created_at:new Date().toISOString(),...extra});
  const A=user('dealer'),B=user('dealer'),driver=user('driver'),unverified=user('driver',{phone_confirmed_at:null});
  const users={'dealer-a':A,'dealer-b':B,'driver':driver,'unverified':unverified};
  for(const u of Object.values(users))await db.query('insert into auth.users values ($1)',[u.id]);
  const vA=randomUUID(),vB=randomUUID();
  for(const [id,owner] of [[vA,A.id],[vB,B.id]])await db.query(`insert into carrier_verification_requests(id,shipper_user_id,dot,carrier_name,email,phone,sms_code_hash,email_verified,phone_verified,license_uploaded,w9_uploaded,coi_uploaded) values ($1,$2,'123456','Carrier','carrier@example.com','5551234567','test',true,true,true,true,true)`,[id,owner]);
  const rpc={tracking_create:['p_shipper','p_verification','p_request','p_payload'],tracking_action:['p_actor','p_phone','p_load','p_action','p_driver'],tracking_pause_all:['p_driver'],tracking_ingest:['p_driver','p_points'],tracking_points:['p_shipper','p_load','p_limit'],tracking_dealer_loads:['p_shipper'],tracking_claim_sms:['p_shipper','p_load'],tracking_pickup:['p_shipper','p_load','p_address','p_latitude','p_longitude'],tracking_add_document:['p_shipper','p_load','p_document','p_name','p_kind','p_mime','p_size','p_path'],tracking_document_state:['p_actor','p_phone','p_load','p_driver'],tracking_document_states:['p_actor','p_phone','p_loads','p_driver'],tracking_unlock_documents:['p_shipper','p_load'],tracking_document_access:['p_actor','p_phone','p_load','p_document','p_driver','p_opened'],pickup_inspection_read:['p_actor','p_load','p_document','p_driver'],pickup_inspection_save:['p_actor','p_load','p_document','p_id','p_damages','p_revision','p_layout','p_share_key','p_catalog'],pickup_inspection_add_photo:['p_actor','p_load','p_document','p_photo','p_damage','p_path','p_mime','p_size'],pickup_inspection_publish:['p_actor','p_load','p_document','p_revision','p_path','p_finish','p_no_damage'],pickup_inspection_photo_access:['p_actor','p_load','p_document','p_photo','p_driver'],pickup_inspection_gallery:['p_key','p_photo']};
  const storedFiles=new Map();
  const server=http.createServer(async(req,res)=>{
    const send=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
    try {
      const url=new URL(req.url,'http://localhost');
      if(url.pathname==='/auth/v1/user') {
        const who=users[req.headers.authorization?.replace(/^Bearer /,'')];
        return who?send(who):send({message:'Invalid token'},401);
      }
      if(req.headers.apikey!=='test-service-key')return send({message:'Unauthorized'},401);
      const chunks=[];for await(const part of req)chunks.push(part);const bytes=Buffer.concat(chunks);
      if(url.pathname.startsWith('/storage/v1/object/')){
        const key=url.pathname.replace(/^\/storage\/v1\/object\/(?:authenticated\/)?(?:pickup-documents|inspection-photos)\//,'');
        if(req.method==='POST'){if(storedFiles.has(key))return send({statusCode:'409',error:'Duplicate',message:'The resource already exists'},409);storedFiles.set(key,{bytes,type:req.headers['content-type']});return send({Key:'pickup-documents/'+key});}
        if(req.method==='GET'){const item=storedFiles.get(key);if(!item)return send({message:'Not found'},404);res.writeHead(200,{'Content-Type':item.type});res.end(item.bytes);return;}
        if(req.method==='DELETE'){for(const key of JSON.parse(bytes.toString()).prefixes || [])storedFiles.delete(key);return send([]);}
      }
      const input=bytes.toString(),data=input?JSON.parse(input):{};
      const name=url.pathname.replace('/rest/v1/rpc/','');
      if(rpc[name]) {
        const args=rpc[name].map(k=>k==='p_loads'?'{'+data[k].join(',')+'}':typeof data[k]==='object'&&data[k]!==null?JSON.stringify(data[k]):data[k]);
        const result=await db.query(`select ${name==='tracking_points'?'* from': ''} ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) ${name==='tracking_points'?'':'result'}`,args);
        return send(name==='tracking_points'?result.rows:result.rows[0].result);
      }
      if(url.pathname==='/rest/v1/tracking_loads') {
        const params=[],where=[];
        for(const key of ['id','shipper_user_id'])if(url.searchParams.get(key)?.startsWith('eq.')){params.push(url.searchParams.get(key).slice(3));where.push(key+'=$'+params.length);}
        if(url.searchParams.has('or')) {
          const value=url.searchParams.get('or'),id=value.match(/driver_user_id.eq.([0-9a-f-]+)/)?.[1],phone=value.match(/driver_phone.eq.(\+?\d+)/)?.[1];
          assert.ok(id&&phone);params.push(id,phone);where.push(`(driver_user_id=$${params.length-1} or (driver_user_id is null and driver_phone=$${params.length} and status='pending'))`);
        }
        if(req.method==='PATCH') {
          const fields=Object.keys(data);assert.ok(fields.every(k=>['invitation_status','invited_at'].includes(k)));
          const offset=params.length;params.push(...fields.map(k=>data[k]));
          await db.query(`update tracking_loads set ${fields.map((k,i)=>k+'=$'+(offset+i+1)).join(',')} where ${where.join(' and ')}`,params);return send(null);
        }
        const result=await db.query(`select * from tracking_loads ${where.length?'where '+where.join(' and '):''} order by created_at desc limit 100`,params);
        const single=req.headers.accept?.includes('object');
        if(single)return result.rows.length===1?send(result.rows[0]):send({code:'PGRST116',message:'No row',details:'0 rows'},406);
        return send(result.rows);
      }
      return send({message:'Unmocked route'},500);
    }catch(e){if(!['42501','22023','23514','P0001'].includes(e.code))console.error('SQL mock:',e.code,e.message);send({code:e.code||'XX000',message:e.message},e.code==='42501'?403:400);}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  // Let Deno choose a free local port and read its startup line.
  // Spawn the executable directly so cleanup stops the server, not just
  // npm's launcher, which otherwise leaves Deno holding the output pipes.
  const deno=new URL(`../node_modules/deno/deno${process.platform==='win32'?'.exe':''}`,import.meta.url);
  const child=spawn(deno.pathname,['run','--node-modules-dir=auto','--no-prompt','--allow-env','--allow-net','--allow-read','supabase/functions/driver-tracking/index.ts'],{cwd:new URL('..',import.meta.url).pathname,env:{...process.env,PORT:'0',SUPABASE_URL:`http://127.0.0.1:${server.address().port}`,SUPABASE_SERVICE_ROLE_KEY:'test-service-key',TWILIO_ACCOUNT_SID:'',TWILIO_AUTH_TOKEN:'',TWILIO_FROM_NUMBER:'',DEV_SMS_OVERRIDE_PHONE:'',TWILIO_TRIAL_TEMPLATE_MODE:'false'}});
  t.after(()=>{child.kill('SIGTERM');});
  let output='';const port=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Deno server startup timed out: '+output)),20000);
    const read=chunk=>{output+=chunk.toString();const match=output.match(/Listening on http:\/\/(?:localhost|0\.0\.0\.0|127\.0\.0\.1):(\d+)/);if(match){clearTimeout(timeout);resolve(Number(match[1]));}};
    child.stdout.on('data',read);child.stderr.on('data',read);child.once('error',reject);child.once('exit',code=>{clearTimeout(timeout);reject(new Error('Deno exited '+code+': '+output));});
  });
  const endpoint=`http://127.0.0.1:${port}/functions/v1/driver-tracking`;
  async function call(path,token,data) {const {response,value}=await fetchJson(endpoint+path,{method:data===undefined?'GET':'POST',headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});return {status:response.status,body:value};}
  assert.equal((await call('/config')).status,200);
  assert.equal((await call('/loads')).status,401);
  assert.equal((await call('/loads','invalid')).status,401);
  assert.equal((await call('/driver/loads','unverified')).status,403);
  assert.equal((await call('/loads','driver')).status,403);
  const input={clientRequestId:randomUUID(),verificationId:vA,title:'Miami delivery',driverName:'John',driverPhone:'5551234567',expiresAt:new Date(Date.now()+86400000).toISOString()};
  assert.equal((await call('/loads','dealer-b',input)).status,403);
  const created=await call('/loads','dealer-a',input);assert.equal(created.status,201);
  assert.equal(created.body.invitation.sent,false,'missing provider configuration is explicit');
  const id=created.body.load.id;
  assert.equal((await call('/loads','dealer-a',input)).status,200,'safe request retry');
  assert.equal((await call('/loads/'+id,'dealer-b')).status,404);
  assert.equal((await call('/loads/'+id+'/points','dealer-b')).status,404);
  assert.equal((await call('/driver/loads','driver')).body.items.length,1);
  assert.equal((await call(`/driver/loads/${id}/start`,'driver',{})).status,400);
  assert.equal((await call(`/driver/loads/${id}/accept`,'driver',{})).body.load.status,'accepted');
  assert.equal((await call(`/driver/loads/${id}/start`,'driver',{})).body.load.status,'active');
  await db.query("update tracking_access_periods set started_at=clock_timestamp()-interval '1 minute' where load_id=$1",[id]);
  const point={id:randomUUID(),latitude:40,longitude:-74,accuracy:8,capturedAt:new Date(Date.now()-1000).toISOString()};
  assert.equal((await call('/driver/locations','driver',{points:[point]})).body.inserted,1);
  assert.equal((await call('/driver/locations','dealer-a',{points:[point]})).status,403);
  assert.equal((await call('/loads','dealer-a')).body.items[0].latestLocation.id,point.id);
  assert.equal((await call('/loads','dealer-b')).body.items.length,0);
  assert.equal((await call('/driver/locations','driver',{points:[{...point,latitude:'40'}]})).status,400);
  const documentId=randomUUID(),source=await PDFDocument.create(),page=source.addPage([612,792]),font=await source.embedFont(StandardFonts.Helvetica);
  page.drawText('ONSITE VEHICLE RELEASE',{x:30,y:720,size:16,font});page.drawText('VIN 4JGFF8KE5NA818644',{x:30,y:600,size:12,font});page.drawText('Subject to Manheim Terms & Conditions',{x:200,y:159,size:7,font});page.drawText('Original footer',{x:30,y:15,size:10,font});
  const pdf=Buffer.from(await source.save());
  const upload=async(token,bytes=pdf,type='application/pdf')=>{
    const form=new FormData();form.append('id',documentId);form.append('kind','gate_pass');form.append('file',new Blob([bytes],{type}),'Gate pass.pdf');
    const response=await fetch(endpoint+`/loads/${id}/documents`,{method:'POST',headers:{Authorization:'Bearer '+token},body:form});return {status:response.status,body:await response.json()};
  };
  assert.equal((await upload('dealer-a')).status,400,'pickup confirmation is required');
  assert.equal((await call(`/loads/${id}/pickup`,'dealer-a',{address:'100 Auction Road',latitude:41,longitude:-74,confirmed:false})).status,400);
  assert.equal((await call(`/loads/${id}/pickup`,'dealer-b',{address:'100 Auction Road',latitude:41,longitude:-74,confirmed:true})).status,403);
  assert.equal((await call(`/loads/${id}/pickup`,'dealer-a',{address:'100 Auction Road',latitude:41,longitude:-74,confirmed:true})).status,200);
  assert.equal((await upload('dealer-b')).status,404);
  assert.equal((await upload('driver')).status,403);
  assert.equal((await upload('dealer-a',Buffer.from('<html>Not a PDF</html>'))).status,400,'reject disguised HTML');
  assert.equal((await upload('dealer-a',pdf,'image/png')).status,400,'reject mismatched MIME');
  assert.equal((await upload('dealer-a')).status,201);
  assert.equal((await upload('dealer-a')).status,201,'safe upload retry');assert.equal(storedFiles.size,1);
  const locked=(await call('/driver/loads','driver')).body.items[0].pickupDocuments;assert.equal(locked.status,'locked');assert.equal(locked.documents[0].object_path,undefined);
  assert.equal((await call(`/driver/loads/${id}/documents/${documentId}/open`,'driver',{})).status,403);
  assert.equal((await call(`/loads/${id}/documents/${documentId}/open`,'dealer-b',{})).status,403);
  assert.equal((await call(`/loads/${id}/documents/unlock`,'dealer-b',{})).status,403);
  assert.equal((await call(`/loads/${id}/documents/unlock`,'dealer-a',{})).body.pickupDocuments.unlockMethod,'manual');
  const issued=await call(`/driver/loads/${id}/documents/${documentId}/open`,'driver',{});assert.equal(issued.status,200);
  const viewer=new URL(issued.body.url),viewerPath=viewer.pathname+viewer.search;
  const beforeOpen=(await call('/driver/loads','driver')).body.items[0].pickupDocuments;assert.equal(beforeOpen.documents[0].openedAt,null);
  const viewed=await fetch(endpoint.replace('/functions/v1/driver-tracking','')+viewerPath);assert.equal(viewed.status,200);assert.equal(viewed.headers.get('Content-Type'),'application/pdf');assert.match(viewed.headers.get('Cache-Control'),/no-store/);assert.deepEqual(Buffer.from(await viewed.arrayBuffer()),pdf);
  assert.ok((await call('/driver/loads','driver')).body.items[0].pickupDocuments.documents[0].openedAt);
  viewer.searchParams.set('ticket',viewer.searchParams.get('ticket')+'tamper');assert.equal((await fetch(endpoint.replace('/functions/v1/driver-tracking','')+viewer.pathname+viewer.search)).status,403);
  const staleTicket=JSON.parse(Buffer.from(new URL(issued.body.url).searchParams.get('ticket').split('.')[0],'base64url').toString());staleTicket.expires=Date.now()-1000;
  const stalePayload=Buffer.from(JSON.stringify(staleTicket)).toString('base64url'),staleSignature=createHmac('sha256','test-service-key').update(stalePayload).digest('base64url');
  assert.equal((await fetch(endpoint+'/documents/view?ticket='+stalePayload+'.'+staleSignature)).status,403,'expired tickets cannot serve bytes');

  const fetchViewer=url=>fetch(endpoint+new URL(url).pathname.replace('/functions/v1/driver-tracking','')+new URL(url).search);
  const inspect=`/driver/loads/${id}/documents/${documentId}/inspection`,ownerInspect=`/loads/${id}/documents/${documentId}/inspection`;
  assert.equal((await call(inspect,'unverified')).status,403);
  assert.equal((await call(ownerInspect,'dealer-b')).status,403);
  const setup=await call(inspect,'driver');assert.equal(setup.status,200);assert.equal(setup.body.suggestedVin,undefined);assert.equal(setup.body.inspection,null);
  const inspectionId=randomUUID(),damageId=randomUUID();
  const damage={id:damageId,areaId:'left-front-door',typeId:'scratch',severity:3};
  let payload={id:inspectionId,revision:0,damages:[damage]};
  assert.equal((await call(inspect,'driver',{...payload,damages:[{...damage,areaId:'windshield'}]})).status,400,'reject body scratch code on glass');
  let saved=await call(inspect,'driver',payload);assert.equal(saved.status,200,JSON.stringify(saved.body));assert.equal(saved.body.inspection.damages[0].code,'10-12-3');assert.equal(saved.body.inspection.vin,undefined,'no VIN field added');
  assert.equal((await call(inspect,'driver',payload)).status,400,'stale write cannot overwrite draft');
  let revision=saved.body.inspection.revision;
  assert.equal((await call(inspect+'/finish','driver',{revision})).status,400,'each damage needs a photo');
  const photoId=randomUUID(),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCfoAAAAASUVORK5CYII=','base64');
  async function uploadPhoto(damageId=damage.id){const form=new FormData();form.append('id',photoId);form.append('damageId',damageId);form.append('file',new Blob([png],{type:'image/png'}),'damage.png');const response=await fetch(endpoint+inspect+'/photos',{method:'POST',headers:{Authorization:'Bearer driver'},body:form});return {status:response.status,body:await response.json()};}
  assert.equal((await uploadPhoto(randomUUID())).status,400,'reject orphan photo');
  saved=await uploadPhoto();assert.equal(saved.status,200,JSON.stringify(saved.body));revision=saved.body.inspection.revision;
  assert.equal((await uploadPhoto()).body.inspection.revision,revision,'photo retry preserves revision and deduplicates');
  const privatePhoto=saved.body.inspection.photos[0].url;assert.equal((await fetchViewer(privatePhoto)).status,200);
  const preview=await call(inspect+'/preview','driver',{revision});assert.equal(preview.status,200,JSON.stringify(preview.body));
  const previewBytes=await fetchViewer(preview.body.url);assert.equal(previewBytes.status,200);assert.equal(previewBytes.headers.get('Content-Type'),'application/pdf');
  const out=await PDFDocument.load(await previewBytes.arrayBuffer());assert.equal(out.getPageCount(),1,'notes appended to original page');
  const raw=await db.query('select share_key from pickup_inspections where id=$1',[inspectionId]),key=raw.rows[0].share_key;
  assert.equal((await fetch(endpoint+'/inspection/photos/'+key)).status,404,'draft photos are not public');
  const changed=await call(inspect,'driver',{...payload,revision});assert.equal(changed.status,200);revision=changed.body.inspection.revision;
  assert.equal((await fetchViewer(preview.body.url)).status,403,'edits invalidate issued preview');
  const done=await call(inspect+'/finish','driver',{revision});assert.equal(done.status,200,JSON.stringify(done.body));assert.equal(done.body.inspection.status,'completed');
  assert.equal((await call(inspect+'/finish','driver',{revision})).body.inspection.revision,revision,'finish safely retries');
  const lockedFinal=await call(inspect,'driver',{...payload,revision,damages:[]});assert.equal(lockedFinal.body.inspection.damages.length,1,'completed notes cannot be overwritten');
  assert.equal((await call(inspect+'/photos','driver',{})).status,400,'completed photos immutable');
  const dealerRead=await call(ownerInspect,'dealer-a');assert.equal(dealerRead.body.inspection.damages.length,1);
  const summary=(await call('/driver/loads','driver')).body.items[0].pickupDocuments.documents[0].inspection;assert.equal(summary.status,'completed');
  const gallery=await fetch(endpoint+'/inspection/photos/'+key);assert.equal(gallery.status,200);assert.match(gallery.headers.get('X-Robots-Tag'),/noindex/);const html=await gallery.text();assert.ok(html.includes('10-12-3'));assert.ok(!html.includes('object_path'));assert.ok(!html.includes('carrier@example.com'));
  assert.equal((await fetch(endpoint+'/inspection/photos/'+key+'/photo/'+photoId)).status,200);
  assert.equal((await fetch(endpoint+'/inspection/photos/'+key+'/photo/'+randomUUID())).status,404);

  const cleanDoc=randomUUID(),cleanId=randomUUID(),cleanForm=new FormData();cleanForm.append('id',cleanDoc);cleanForm.append('kind','gate_pass');cleanForm.append('file',new Blob([pdf],{type:'application/pdf'}),'Second gate pass.pdf');
  assert.equal((await fetch(endpoint+`/loads/${id}/documents`,{method:'POST',headers:{Authorization:'Bearer dealer-a'},body:cleanForm})).status,201);
  const cleanPath=`/driver/loads/${id}/documents/${cleanDoc}/inspection`;
  const clean=await call(cleanPath,'driver',{id:cleanId,revision:0,damages:[]});assert.equal(clean.status,200);
  assert.equal((await call(cleanPath+'/finish','driver',{revision:1})).status,400,'empty inspection requires explicit observation');
  const noDamage=await call(cleanPath+'/finish','driver',{revision:1,noDamageObserved:true});assert.equal(noDamage.status,200);assert.equal(noDamage.body.inspection.noDamageObserved,true);
  assert.equal((await call('/loads/'+id+'/complete','dealer-b',{})).status,404);
  assert.equal((await call('/loads/'+id+'/complete','dealer-a',{})).body.load.status,'completed');
  assert.equal((await fetch(endpoint.replace('/functions/v1/driver-tracking','')+viewerPath)).status,403,'a previously issued viewer link is denied after completion');
  assert.equal((await fetchViewer(done.body.url)).status,403,'cancelled/completed load closes annotated gate pass access');
  assert.equal((await fetch(endpoint+'/inspection/photos/'+key)).status,200,'printed damage photo evidence remains available');
  assert.equal((await call(ownerInspect+'/open','dealer-a',{})).status,200,'owner retains annotated pass');
  const after={...point,id:randomUUID(),capturedAt:new Date().toISOString()};
  assert.equal((await call('/driver/locations','driver',{points:[after]})).body.inserted,0);
  assert.equal((await call('/loads/'+id+'/points','dealer-a')).body.points.length,1);
  assert.equal((await call('/driver/pause-all','driver',{})).status,200);
});
