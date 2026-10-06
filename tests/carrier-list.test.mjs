import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';

test('Carrier lookup resumes older pending requests and stays scoped to the signed-in workspace', async t => {
  const owner=randomUUID(),other=randomUUID(),queries=[];
  const old={id:randomUUID(),shipper_user_id:owner,dot:'1234567',carrier_name:'Existing carrier',email:'carrier@example.test',phone:'5551234567',email_verified:true,phone_verified:true,license_uploaded:true,w9_uploaded:false,coi_uploaded:false,created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-02T00:00:00Z'};
  const records=[...Array.from({length:101},(_,i)=>({...old,id:randomUUID(),dot:String(2000000+i),created_at:'2026-10-01T00:00:00Z'})),{...old,id:randomUUID(),shipper_user_id:other,created_at:'2026-10-05T00:00:00Z'},old];
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    const send=(body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
    if(url.pathname==='/auth/v1/user')return req.headers.authorization==='Bearer fixture-session'?send({id:owner,aud:'authenticated',role:'authenticated',email:'dealer@example.test'}):send({message:'Invalid token'},401);
    if(url.pathname==='/rest/v1/carrier_verification_requests'){
      queries.push(url.searchParams);
      assert.equal(url.searchParams.get('shipper_user_id'),'eq.'+owner);
      let rows=records.filter(v=>v.shipper_user_id===owner);
      const dot=url.searchParams.get('dot');if(dot)rows=rows.filter(v=>v.dot===dot.slice(3));
      return send(rows.slice(0,Number(url.searchParams.get('limit'))));
    }
    send({message:'Unexpected endpoint'},500);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const child=spawn(new URL('../node_modules/deno/deno',import.meta.url).pathname,['run','--node-modules-dir=auto','--no-prompt','--allow-env','--allow-net','--allow-read','supabase/functions/carrier-verify/index.ts'],{cwd:new URL('..',import.meta.url).pathname,env:{...process.env,PORT:'0',SUPABASE_URL:`http://127.0.0.1:${server.address().port}`,SUPABASE_SERVICE_ROLE_KEY:'test-service-key',RESEND_API_KEY:'fixture',TWILIO_ACCOUNT_SID:'fixture',TWILIO_AUTH_TOKEN:'fixture',TWILIO_FROM_NUMBER:'fixture',OTP_HASH_SECRET:'fixture'}});
  t.after(()=>child.kill('SIGTERM'));
  let output='';const port=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error(output)),20000);
    const read=chunk=>{output+=chunk;const match=output.match(/Listening on http:\/\/[^:]+:(\d+)/);if(match){clearTimeout(timer);resolve(Number(match[1]));}};
    child.stdout.on('data',read);child.stderr.on('data',read);child.once('error',reject);child.once('exit',()=>{clearTimeout(timer);reject(new Error(output));});
  });
  async function get(query,token='fixture-session') {const r=await fetch(`http://127.0.0.1:${port}/carrier-verify/verification-requests`+query,{headers:token?{Authorization:'Bearer '+token}:{}});return {status:r.status,body:await r.json()};}
  assert.equal((await get('?limit=100')).body.items.length,100);
  const existing=await get('?dot=1234567&limit=1');
  assert.equal(existing.status,200);assert.equal(existing.body.items.length,1);assert.equal(existing.body.items[0].id,old.id);assert.equal(existing.body.items[0].status,'pending');
  assert.equal(queries.at(-1).get('dot'),'eq.1234567');
  assert.equal((await get('?dot=7654321&limit=1')).body.items.length,0);
  assert.equal((await get('?dot=bad')).status,400);
  assert.equal((await get('?dot=1234567','')).status,401);
});
