import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('Edge API: real SDK and SQL, verified driver login, ownership and scoped location',async t=>{
  const db=await PGlite.create();t.after(()=>db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.role() returns text language sql as $$select current_user::text$$;create schema storage;create table storage.buckets(id text primary key,name text,public boolean);`);
  for(const file of ['20260911232000_carrier_verify.sql','20260912033000_add_w9_coi_documents.sql','20261003164500_add_shipper_user_to_verifications.sql','20261005180000_driver_tracking.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
  const user=(kind,extra={})=>({id:randomUUID(),aud:'authenticated',role:'authenticated',email:kind==='dealer'?'dealer@example.com':null,email_confirmed_at:kind==='dealer'?new Date().toISOString():null,phone:kind==='driver'?'15551234567':null,phone_confirmed_at:kind==='driver'?new Date().toISOString():null,user_metadata:{company_name:'Test dealer'},app_metadata:{},created_at:new Date().toISOString(),...extra});
  const A=user('dealer'),B=user('dealer'),driver=user('driver'),unverified=user('driver',{phone_confirmed_at:null});
  const users={'dealer-a':A,'dealer-b':B,'driver':driver,'unverified':unverified};
  for(const u of Object.values(users))await db.query('insert into auth.users values ($1)',[u.id]);
  const vA=randomUUID(),vB=randomUUID();
  for(const [id,owner] of [[vA,A.id],[vB,B.id]])await db.query(`insert into carrier_verification_requests(id,shipper_user_id,dot,carrier_name,email,phone,sms_code_hash,email_verified,phone_verified,license_uploaded,w9_uploaded,coi_uploaded) values ($1,$2,'123456','Carrier','carrier@example.com','5551234567','test',true,true,true,true,true)`,[id,owner]);
  const rpc={tracking_create:['p_shipper','p_verification','p_request','p_payload'],tracking_action:['p_actor','p_phone','p_load','p_action','p_driver'],tracking_pause_all:['p_driver'],tracking_ingest:['p_driver','p_points'],tracking_points:['p_shipper','p_load','p_limit'],tracking_dealer_loads:['p_shipper'],tracking_claim_sms:['p_shipper','p_load']};
  const server=http.createServer(async(req,res)=>{
    const send=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
    try {
      const url=new URL(req.url,'http://localhost');
      if(url.pathname==='/auth/v1/user') {
        const who=users[req.headers.authorization?.replace(/^Bearer /,'')];
        return who?send(who):send({message:'Invalid token'},401);
      }
      if(req.headers.apikey!=='test-service-key')return send({message:'Unauthorized'},401);
      let input='';for await(const part of req)input+=part;
      const data=input?JSON.parse(input):{};
      const name=url.pathname.replace('/rest/v1/rpc/','');
      if(rpc[name]) {
        const args=rpc[name].map(k=>typeof data[k]==='object'&&data[k]!==null?JSON.stringify(data[k]):data[k]);
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
    }catch(e){send({code:e.code||'XX000',message:e.message},e.code==='42501'?403:400);}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
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
  async function call(path,token,data) {const response=await fetch(endpoint+path,{method:data===undefined?'GET':'POST',headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});return {status:response.status,body:await response.json()};}
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
  assert.equal((await call('/loads/'+id+'/complete','dealer-b',{})).status,404);
  assert.equal((await call('/loads/'+id+'/complete','dealer-a',{})).body.load.status,'completed');
  const after={...point,id:randomUUID(),capturedAt:new Date().toISOString()};
  assert.equal((await call('/driver/locations','driver',{points:[after]})).body.inserted,0);
  assert.equal((await call('/loads/'+id+'/points','dealer-a')).body.points.length,1);
  assert.equal((await call('/driver/pause-all','driver',{})).status,200);
});
