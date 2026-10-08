import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('Pickup documents: private files, exact one-mile arrival, fresh scoped GPS, manual override and terminal access',async t=>{
  const db=await PGlite.create();t.after(()=>db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.role() returns text language sql as $$select current_user::text$$;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid,bucket_id text);alter table storage.objects enable row level security;`);
  for(const file of ['20260911232000_carrier_verify.sql','20260912033000_add_w9_coi_documents.sql','20261003164500_add_shipper_user_to_verifications.sql','20261005180000_driver_tracking.sql','20261007180000_pickup_documents.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
  const dealer=randomUUID(),otherDealer=randomUUID(),driver=randomUUID(),otherDriver=randomUUID(),verification=randomUUID();
  for(const id of [dealer,otherDealer,driver,otherDriver])await db.query('insert into auth.users values ($1)',[id]);
  await db.query(`insert into carrier_verification_requests(id,shipper_user_id,dot,carrier_name,email,phone,sms_code_hash,email_verified,phone_verified,license_uploaded,w9_uploaded,coi_uploaded) values($1,$2,'123456','Carrier','carrier@example.com','5551234567','test',true,true,true,true,true)`,[verification,dealer]);
  const rpc=async(name,args)=> (await db.query(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
  async function create(){return (await rpc('tracking_create',[dealer,verification,randomUUID(),JSON.stringify({dealer_name:'Dealer',driver_name:'Driver',driver_phone:'+15551234567',title:'Load',expires_at:new Date(Date.now()+86400000).toISOString()})])).load.id;}
  const action=(id,verb)=>rpc('tracking_action',[driver,'+15551234567',id,verb,true]);
  const state=(id,actor=driver,isDriver=true,phone='+15551234567')=>rpc('tracking_document_state',[actor,phone,id,isDriver]);
  const file=(id,doc=randomUUID(),path=`${id}/${doc}/hash.pdf`)=>rpc('tracking_add_document',[dealer,id,doc,'Gate pass.pdf','gate_pass','application/pdf',20,path]);
  const access=(id,doc,actor=driver,isDriver=true,opened=false)=>rpc('tracking_document_access',[actor,'+15551234567',id,doc,isDriver,opened]);
  async function fix(id,{latitude=0,accuracy=8,age=1,receivedAge=0}={}){
    const point=randomUUID();await rpc('tracking_ingest',[driver,JSON.stringify([{id:point,latitude,longitude:0,accuracy,captured_at:new Date(Date.now()-age*1000).toISOString()}])]);
    if(receivedAge)await db.query("update tracking_locations set received_at=clock_timestamp()-($1 * interval '1 second') where id=$2",[receivedAge,point]);
    return point;
  }
  const id=await create(),doc=randomUUID();
  await assert.rejects(()=>file(id,doc),/Confirm the pickup/);
  await assert.rejects(()=>rpc('tracking_pickup',[otherDealer,id,'100 Auction Road',0,0]),/Load not found/);
  await assert.rejects(()=>rpc('tracking_pickup',[dealer,id,'100 Auction Road',null,0]),/Confirm the exact/);
  await rpc('tracking_pickup',[dealer,id,'100 Auction Road, Miami FL 33101',0,0]);
  await file(id,doc);assert.equal(await file(id,doc),doc,'upload retry does not duplicate file');
  await assert.rejects(()=>file(id,doc,`${id}/${doc}/different.pdf`),/already in use/);
  await assert.rejects(()=>state(id,otherDealer,false),/Load not found/);
  await assert.rejects(()=>state(id,otherDriver,true,'+15557654321'),/Load not found/);
  assert.equal((await state(id)).status,'locked');
  assert.equal((await state(id)).documents[0].object_path,undefined,'metadata never includes storage paths');
  await assert.rejects(()=>access(id,doc),/available at pickup/);
  await action(id,'accept');await action(id,'start');
  await db.query("update tracking_access_periods set started_at=clock_timestamp()-interval '10 minutes' where load_id=$1",[id]);
  await fix(id,{latitude:.02});assert.equal((await state(id)).status,'locked','outside one mile');
  await fix(id,{age:120});
  // The latest point is still outside; replace the outside point for isolated age tests.
  await db.query('delete from tracking_locations where driver_user_id=$1',[driver]);
  await fix(id,{age:120});assert.equal((await state(id)).status,'locked','old capture cannot unlock');
  await fix(id,{age:1,receivedAge:120});assert.equal((await state(id)).status,'locked','old receipt cannot unlock');
  await fix(id,{accuracy:250,age:0});assert.equal((await state(id)).status,'locked','inaccurate GPS cannot unlock');
  await db.query('delete from tracking_locations where driver_user_id=$1',[driver]);
  await fix(id,{latitude:1605/6371000*180/Math.PI});assert.equal((await state(id)).status,'locked','accuracy straddling the mile boundary stays locked');
  await db.query('delete from tracking_locations where driver_user_id=$1',[driver]);
  await fix(id,{latitude:1500/6371000*180/Math.PI});
  const released=await state(id);assert.equal(released.status,'available');assert.equal(released.unlockMethod,'arrival');assert.equal(released.canOpen,true);
  assert.equal((await access(id,doc)).opened_at,null,'issuing a link is not yet Opened');
  assert.ok((await access(id,doc,driver,true,true)).opened_at);
  await assert.rejects(()=>access(id,doc,otherDriver,true),/Load not found/,'same phone cannot take over accepted documents');
  await assert.rejects(()=>rpc('tracking_pickup',[dealer,id,'Another address',1,0]),/cannot change/);
  await action(id,'pause');assert.equal((await state(id)).canOpen,true,'GPS loss or pause after arrival does not relock');
  await rpc('tracking_action',[dealer,'',id,'cancel',false]);
  assert.equal((await state(id)).status,'closed');await assert.rejects(()=>access(id,doc),/closed/);
  assert.equal((await access(id,doc,dealer,false)).id,doc,'owner can still view their original attachment');
  await assert.rejects(()=>rpc('tracking_unlock_documents',[dealer,id]),/closed/);
  const manual=await create(),manualDoc=randomUUID();await rpc('tracking_pickup',[dealer,manual,'100 Auction Road',10,10]);await file(manual,manualDoc);
  await assert.rejects(()=>rpc('tracking_unlock_documents',[otherDealer,manual]),/Load not found/);
  await rpc('tracking_unlock_documents',[dealer,manual]);
  assert.equal((await state(manual)).canOpen,false,'manual unlock before acceptance does not grant phone-only access');
  await assert.rejects(()=>access(manual,manualDoc),/available at pickup/);
  await action(manual,'accept');assert.equal((await state(manual)).canOpen,true,'dealer override works without location sharing');
  assert.equal((await state(manual)).unlockMethod,'manual');
  await db.query("update tracking_loads set expires_at=clock_timestamp()-interval '1 second' where id=$1",[manual]);
  await assert.rejects(()=>access(manual,manualDoc),/closed/,'expiry is enforced without a maintenance job');
  const scoped=await create(),scopedDoc=randomUUID();await rpc('tracking_pickup',[dealer,scoped,'100 Auction Road',0,0]);await file(scoped,scopedDoc);await action(scoped,'accept');await action(scoped,'start');
  assert.equal((await state(scoped)).status,'locked','another load\'s earlier consent cannot release these documents');
  assert.equal((await db.query("select public from storage.buckets where id='pickup-documents'")).rows[0].public,false);
  await db.exec("grant usage on schema storage to anon,authenticated;grant select,insert on storage.objects to anon,authenticated;create policy unrelated_public_policy on storage.objects for all to anon,authenticated using(true) with check(true);insert into storage.objects values(gen_random_uuid(),'pickup-documents'),(gen_random_uuid(),'legacy-bucket');");
  for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(()=>db.query('select * from tracking_documents'),/permission denied/);await assert.rejects(()=>state(scoped),/permission denied/);assert.deepEqual((await db.query('select bucket_id from storage.objects')).rows.map(v=>v.bucket_id),['legacy-bucket'],'even a broad permissive Storage policy cannot expose pickup documents');await assert.rejects(()=>db.query("insert into storage.objects values(gen_random_uuid(),'pickup-documents')"),/row-level security/);await db.exec('reset role');}
});
