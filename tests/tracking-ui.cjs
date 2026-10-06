const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {chromium}=require('playwright');

const root=path.resolve(__dirname,'..');
const origin='https://workspace.test';
const project='https://yqpeebgmqtqoxumzfrsq.supabase.co';
const user={id:randomUUID(),email:'dealer@example.com',user_metadata:{full_name:'Test Dealer',company_name:'Northline Logistics'}};
const session={user,access_token:'test-session',expires_at:Math.floor(Date.now()/1000)+3600};
const verification={id:randomUUID(),carrierName:'OMAX LLC',dot:'4345567',mc:'MC1698436',email:'carrier@example.com',phone:'3075551234',emailVerified:true,phoneVerified:true,licenseUploaded:true,w9Uploaded:true,coiUploaded:true,status:'verified',createdAt:new Date().toISOString()};
function fixture(status,title,phone='+15551234567') {return {id:randomUUID(),verificationId:verification.id,title,status,dealerName:'Northline Logistics',carrierName:'OMAX LLC',carrierDot:'4345567',driverName:'John Smith',driverPhone:phone,vehicles:['2024 Toyota Camry · Stock #184'],pickupAddress:'Auction · Atlanta, GA',deliveryAddress:'Dealership · Miami, FL',plannedAt:null,expiresAt:new Date(Date.now()+86400000).toISOString(),createdAt:new Date().toISOString(),invitationStatus:'sent',invitedAt:new Date().toISOString(),latestLocation:status==='active'?{id:randomUUID(),latitude:33.749,longitude:-84.388,accuracy:12,capturedAt:new Date(Date.now()-30000).toISOString()}:null};}
(async()=>{
 const executable=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined);
 const browser=await chromium.launch({headless:true,...(executable?{executablePath:executable}:{})});
 try{
 const ctx=await browser.newContext({viewport:{width:1440,height:1000}}),errors=[];
 let loads=[fixture('active','Load #1042 — Miami'),fixture('pending','Load #1043 — Tampa','+15551234568'),fixture('accepted','Load #1044 — Orlando','+15551234569')],created,failLoads=false,failCreateNetwork=false;
 await ctx.route(origin+'/**',async route=>{
   const pathname=new URL(route.request().url()).pathname;
   const relative=pathname==='/admin/'?'/admin/index.html':pathname==='/driver/'?'/driver/index.html':pathname;
   const file=path.join(root,'public',relative);
   if(!file.startsWith(path.join(root,'public'))||!fs.existsSync(file))return route.fulfill({status:404,body:'Not found'});
   const types={'.html':'text/html','.css':'text/css','.js':'application/javascript','.svg':'image/svg+xml','.png':'image/png'};
   return route.fulfill({contentType:types[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
 });
 await ctx.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',r=>r.fulfill({contentType:'application/javascript',body:`window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:${JSON.stringify(session)}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({}),updateUser:async()=>({data:{user:${JSON.stringify(user)}}})}})};`}));
 await ctx.route('https://*.tile.openstreetmap.org/**',r=>r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1cAAAAASUVORK5CYII=','base64')}));
 await ctx.route(project+'/**',async route=>{
   const req=route.request(),url=new URL(req.url());
   const respond=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
   if(url.pathname.includes('/carrier-verify/verification-requests'))return respond({items:[verification]});
   if(url.pathname.endsWith('/driver-tracking/config'))return respond({iosStoreUrl:'',androidStoreUrl:''});
   assert.equal(req.headers().authorization,'Bearer test-session');
   const p=url.pathname.split('/driver-tracking')[1];
   if(p==='/loads'&&req.method()==='GET')return failLoads?respond({error:'Tracking unavailable'},503):respond({items:loads});
   if(p==='/loads'&&req.method()==='POST'){
     if(failCreateNetwork)return route.abort('failed');
     created=req.postDataJSON();const v=fixture('pending',created.title,created.driverPhone);Object.assign(v,{driverName:created.driverName,vehicles:created.vehicles,deliveryAddress:created.deliveryAddress,pickupAddress:created.pickupAddress,invitationStatus:'failed',invitedAt:null});loads.unshift(v);return respond({load:v,invitation:{sent:false,message:'Load saved, but the SMS could not be sent. You can retry from its tracking card.'}},201);
   }
   if(p?.endsWith('/points')){const v=loads.find(v=>p.includes(v.id));return respond({points:v?.latestLocation?[v.latestLocation]:[]});}
   const match=p?.match(/^\/loads\/([^/]+)\/(resend|complete|cancel)$/);
   if(match){const v=loads.find(v=>v.id===match[1]);if(match[2]==='resend'){v.invitationStatus='sent';return respond({invitation:{sent:true,message:'Invitation sent.'}});}v.status=match[2]==='complete'?'completed':'cancelled';return respond({load:v});}
   return respond({error:'Unexpected fixture endpoint'},500);
 });
 const page=await ctx.newPage();page.on('pageerror',e=>{errors.push(e.message);console.error('Browser error:',e.message);});page.on('dialog',d=>d.accept());
 await page.goto(origin+'/admin/#tracking');
 await page.locator('#tracking.active').waitFor();await page.waitForFunction(()=>document.getElementById('tracking-active-count').textContent==='1');
 assert.equal(await page.locator('.sidebar [data-view]').count(),5);
 assert.equal(await page.locator('#page-title').textContent(),'Tracking');
 assert.equal(await page.locator('.tracking-card').count(),3);
 await page.locator('#tracking-map.leaflet-container').waitFor();
 await page.waitForFunction(()=>{const map=document.getElementById('tracking-map');const svg=map.querySelector('.leaflet-overlay-pane svg');return svg && svg.getBoundingClientRect().width>=map.clientWidth;});
 await page.waitForTimeout(200);
 await page.screenshot({path:'/private/tmp/deeptruck-tracking-desktop.png'});
 await page.locator('#new-tracking-button').click();
 await page.locator('#tracking-create-dialog[open]').waitFor();
 await page.locator('#tracking-carrier').selectOption(verification.id);
 await page.locator('#tracking-driver-name').fill('Mike Jones');await page.locator('#tracking-driver-phone').fill('+15557654321');
 await page.locator('#tracking-load-name').fill('Load #1045 — Test delivery');await page.locator('#tracking-vehicles').fill('Toyota Camry · VIN 1\nHonda Accord · VIN 2');
 await page.locator('#tracking-pickup').fill('Atlanta auction');await page.locator('#tracking-delivery').fill('Miami dealership');
 await page.screenshot({path:'/private/tmp/deeptruck-tracking-create.png'});
 failCreateNetwork=true;
 await page.locator('#tracking-create-submit').click();
 await page.waitForFunction(()=>document.getElementById('tracking-create-message').textContent.includes('Could not connect to tracking'));
 assert.equal(await page.locator('#tracking-create-dialog').evaluate(el=>el.open),true);
 assert.equal(await page.locator('#tracking-driver-phone').inputValue(),'+15557654321');
 assert.equal(await page.locator('#tracking-load-name').inputValue(),'Load #1045 — Test delivery');
 assert.equal(await page.locator('#tracking-create-submit').isEnabled(),true);
 failCreateNetwork=false;
 await page.locator('#tracking-create-submit').click();await page.waitForFunction(()=>!document.getElementById('tracking-create-dialog').open);
 await page.waitForFunction(()=>document.getElementById('tracking-message').textContent.includes('SMS could not'));
 assert.equal(created.verificationId,verification.id);assert.equal(created.driverPhone,'+15557654321');assert.equal(created.vehicles.length,2);assert.match(created.clientRequestId,/^[0-9a-f-]{36}$/);
 await page.locator('[data-tracking-action="resend"]').click();await page.waitForFunction(()=>document.getElementById('tracking-message').textContent==='Invitation sent.');
 await page.locator('#tracking-search').fill('Orlando');assert.equal(await page.locator('.tracking-card').count(),1);
 await page.locator('[data-tracking-action="complete"]').click();await page.waitForFunction(()=>document.getElementById('tracking-message').textContent.includes('Load completed'));
 await page.locator('#tracking-search').fill('');await page.locator('#tracking-filter').selectOption('completed');assert.equal(await page.locator('.tracking-card').count(),1);
 await page.locator('#tracking-filter').selectOption('open');
 for(const width of [320,390,768,1024,1440,2048]){
   await page.setViewportSize({width,height:1000});
   for(const view of ['verifications','history','tracking','billing','settings']){
     await page.locator(`[data-view="${view}"]`).click();
     assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}px ${view}: horizontal overflow`);
   }
   await page.locator('[data-view="tracking"]').click();
   if(width===390)await page.screenshot({path:'/private/tmp/deeptruck-tracking-mobile.png'});
   await page.locator('#new-tracking-button').click();
   assert.ok(await page.locator('#tracking-create-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth),`${width}px dialog overflow`);
   await page.keyboard.press('Escape');assert.equal(await page.locator('#tracking-create-dialog').evaluate(el=>el.open),false);
   console.log(`PASS ${width}px: five menus, Tracking and creation dialog`);
 }
 await page.locator('[data-view="history"]').click();await page.locator('#history-body .carrier-link').first().click();
 await page.locator('#create-tracking-from-verification').click();assert.equal(await page.locator('#tracking-carrier').inputValue(),verification.id);
 await page.keyboard.press('Escape');await page.reload();await page.locator('#tracking.active').waitFor();
 failLoads=true;await page.locator('#tracking-refresh').click();await page.waitForFunction(()=>document.getElementById('tracking-message').textContent==='Tracking unavailable');
 assert.ok(await page.locator('.tracking-card').count()>0,'refresh failures preserve prior records');
 await page.goto(origin+'/driver/?invite='+loads[0].id);assert.equal(await page.locator('#open-driver').getAttribute('href'),'deeptruck-driver://loads?invite='+loads[0].id);
 await page.waitForFunction(()=>document.getElementById('install-status').textContent.includes('pilot testing'));
 assert.deepEqual(errors,[]);console.log('PASS creation payload, SMS failure/retry, filtering, completion, verification handoff, deep link, refresh error and driver invitation');
 await ctx.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
