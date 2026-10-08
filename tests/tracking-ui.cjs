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
const verification={id:randomUUID(),carrierName:'Northline Transport',dot:'4345567',mc:'MC123456',email:'carrier@example.com',phone:'2025550148',emailVerified:true,phoneVerified:true,licenseUploaded:true,w9Uploaded:true,coiUploaded:true,status:'verified',createdAt:new Date().toISOString(),verificationUrl:'https://www.deeptruck.io/verify?token=fixture',documents:{license:{url:'https://documents.test/license.pdf',fileName:'License.pdf'},w9:{url:'https://documents.test/w9.pdf',fileName:'W9.pdf'},coi:{url:'https://documents.test/coi.pdf',fileName:'COI.pdf'}}};
const pendingVerification={...verification,id:randomUUID(),carrierName:'Northline Transport',dot:'1234567',status:'pending',w9Uploaded:false,coiUploaded:false,verificationUrl:'https://www.deeptruck.io/verify?token=pending'};
function fixture(status,title,phone='+15551234567') {return {id:randomUUID(),verificationId:verification.id,title,status,dealerName:'Northline Logistics',carrierName:verification.carrierName,carrierDot:verification.dot,driverName:'John Smith',driverPhone:phone,vehicles:['2024 Toyota Camry · Stock #184'],pickupAddress:'Auction · Atlanta, GA',deliveryAddress:'Dealership · Miami, FL',plannedAt:null,expiresAt:new Date(Date.now()+86400000).toISOString(),createdAt:new Date().toISOString(),invitationStatus:'sent',invitedAt:new Date().toISOString(),latestLocation:status==='active'?{id:randomUUID(),latitude:33.749,longitude:-84.388,accuracy:12,capturedAt:new Date(Date.now()-30000).toISOString()}:null};}
(async()=>{
 const executable=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined);
 const browser=await chromium.launch({headless:true,...(executable?{executablePath:executable}:{})});
 try{
 const ctx=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']}),errors=[];
 let failUploadOnce=false,documentRequests=[];
 let verificationPosts=0,requests=[],verifications=[verification,pendingVerification],failExisting=false;
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
 await ctx.route('https://photon.komoot.io/api/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({features:[{geometry:{type:'Point',coordinates:[-84.388,33.749]},properties:{name:'Auction entrance',housenumber:'100',street:'Auction Road',city:'Atlanta',state:'Georgia',postcode:'30303'}}]})}));
 await ctx.route('https://documents.test/photo.png',r=>r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCfoAAAAASUVORK5CYII=','base64')}));
 await ctx.route(project+'/**',async route=>{
   const req=route.request(),url=new URL(req.url());
   const respond=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
   if(url.pathname.includes('/carrier-verify/verification-requests')){
     assert.equal(req.headers().authorization,'Bearer test-session');
     if(req.method()==='POST'){verificationPosts++;const body=req.postDataJSON();const saved={...pendingVerification,...body,id:randomUUID()};verifications.unshift(saved);return respond(saved);}
     const dot=url.searchParams.get('dot');if(dot&&failExisting)return respond({error:'Could not check existing requests'},503);
     const record=verifications.find(v=>url.pathname.endsWith(v.id));if(record)return respond(record);
     return respond({items:dot?verifications.filter(v=>v.dot===dot):verifications});
   }
   if(url.pathname.includes('/carrier-lookup/'))return respond({name:'Northline Transport',dot:url.pathname.split('/').at(-1),mc:'MC123',email:'carrier@example.com',phone:'3075551234',fleet:{powerUnits:12,drivers:12},insurance:{bocFiled:true,minimumBipdAmount:1000000},authorityStatus:'Active'});
   if(url.pathname.endsWith('/driver-tracking/config'))return respond({iosStoreUrl:'',androidStoreUrl:''});
   assert.equal(req.headers().authorization,'Bearer test-session');
   const p=url.pathname.split('/driver-tracking')[1];
   documentRequests.push(p);
   if(p?.includes('/inspection')){if(p.endsWith('/open'))return respond({url:'https://documents.test/annotated.pdf'});return respond({inspection:{id:'inspection',status:'completed',completedAt:new Date().toISOString(),shareUrl:'https://documents.test/photos',damages:[{id:'damage',code:'10-12-3',areaLabel:'Left front door',typeLabel:'Scratch',sizeLabel:'Over 3–6 in'}],photos:[{id:'photo',damageId:'damage',url:'https://documents.test/photo.png'}]}});}
   const docMatch=p?.match(/^\/loads\/([^/]+)\/(pickup|documents(?:\/(unlock)|\/([^/]+)\/(open))?)$/);
   if(docMatch){
     const load=loads.find(v=>v.id===docMatch[1]);if(!load)return respond({error:'Missing load'},404);
     if(docMatch[2]==='pickup'){const body=req.postDataJSON();assert.equal(body.confirmed,true);load.pickupLocation={latitude:body.latitude,longitude:body.longitude,radiusMiles:1};load.pickupAddress=body.address;return respond({saved:true});}
     if(docMatch[2]==='documents'){
       if(failUploadOnce){failUploadOnce=false;return route.abort('failed');}
       const multipart=req.postDataBuffer().toString();assert.match(multipart,/%PDF-/);const documentId=multipart.match(/name="id"\r\n\r\n([^\r]+)/)[1];
       load.pickupDocuments ||= {documents:[],status:'locked',canOpen:false,unlockedAt:null,unlockMethod:null};
       if(!load.pickupDocuments.documents.some(d=>d.id===documentId))load.pickupDocuments.documents.push({id:documentId,name:'Gate pass.pdf',kind:multipart.includes('release_form')?'release_form':'gate_pass',openedAt:null});
       return respond({saved:true,id:documentId},201);
     }
     if(docMatch[3]){Object.assign(load.pickupDocuments,{status:'available',unlockedAt:new Date().toISOString(),unlockMethod:'manual'});return respond({pickupDocuments:load.pickupDocuments});}
     return respond({url:'https://documents.test/pickup.pdf'});
   }
   if(p==='/loads'&&req.method()==='GET')return failLoads?respond({error:'Tracking unavailable'},503):respond({items:loads});
   if(p==='/loads'&&req.method()==='POST'){
     requests.push(req.postDataJSON());if(failCreateNetwork)return route.abort('failed');
     created=req.postDataJSON();const v=fixture('pending',created.title,created.driverPhone);Object.assign(v,{driverName:created.driverName,vehicles:created.vehicles,deliveryAddress:created.deliveryAddress,pickupAddress:created.pickupAddress,invitationStatus:created.deferInvitation?'not_sent':'failed',invitedAt:null});loads.unshift(v);return respond({load:v,invitation:{sent:false,message:'Load saved, but the SMS could not be sent. You can retry from its tracking card.'}},201);
   }
   if(p?.endsWith('/points')){const v=loads.find(v=>p.includes(v.id));return respond({points:v?.latestLocation?[v.latestLocation]:[]});}
   const match=p?.match(/^\/loads\/([^/]+)\/(resend|complete|cancel)$/);
   if(match){const v=loads.find(v=>v.id===match[1]);if(match[2]==='resend'){v.invitationStatus='sent';return respond({invitation:{sent:true,message:'Invitation sent.'}});}v.status=match[2]==='complete'?'completed':'cancelled';return respond({load:v});}
   return respond({error:'Unexpected fixture endpoint'},500);
 });
 const page=await ctx.newPage();page.on('pageerror',e=>{errors.push(e.message);console.error('Browser error:',e.message);});page.on('dialog',d=>d.accept());
 await page.goto(origin+'/admin/#tracking');
 await page.locator('#tracking.active').waitFor();await page.waitForFunction(()=>document.getElementById('tracking-active-count').textContent==='1');
 assert.equal(await page.locator('.sidebar nav:not(.secondary-nav) [data-view]').count(),2);
 assert.equal(await page.locator('#page-title').textContent(),'Tracking');
 assert.equal(await page.locator('.tracking-card').count(),3);
 await page.locator('#tracking-map.leaflet-container').waitFor();
 await page.waitForFunction(()=>{const map=document.getElementById('tracking-map');const svg=map.querySelector('.leaflet-overlay-pane svg');return svg && svg.getBoundingClientRect().width>=map.clientWidth;});
 await page.waitForTimeout(200);
 await page.screenshot({path:'/private/tmp/deeptruck-tracking-desktop.png'});
 if(process.env.HELP_SCREENSHOTS){
   // Screenshot-only illustrative map; every control is the actual workspace UI.
   await page.locator('#tracking-map').evaluate(el=>{
     const illustration=document.createElement('div');illustration.id='help-demo-map';
     illustration.style.cssText='position:absolute;inset:0;z-index:450;pointer-events:none';
     illustration.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 310" width="100%" height="100%" preserveAspectRatio="xMidYMid slice"><rect width="700" height="310" fill="#edf1ea"/><path d="M0 225Q150 160 210 210T430 140T700 130" stroke="#bdddeb" stroke-width="38" fill="none"/><path d="M20 50h140v70H20zM450 180h120v80H450zM500 25h160v65H500z" fill="#d4e5cf"/><g stroke="#fff" stroke-width="9"><path d="M0 60h700M0 125h700M0 190h700M0 255h700M80 0v310M160 0v310M240 0v310M320 0v310M400 0v310M480 0v310M560 0v310M640 0v310"/></g><path d="M0 285 700 20" stroke="#d8c6a1" stroke-width="15"/><path d="M0 285 700 20" stroke="#fff2d9" stroke-width="10"/><g font-family="Arial,sans-serif" fill="#667b80" font-size="12"><text x="120" y="104">Pickup area</text><text x="430" y="168">Delivery area</text><text x="16" y="293">Illustrative map · example location</text></g></svg>';
     illustration.querySelector('svg').style.cssText='width:100%;height:100%;display:block;stroke:none';
     const point=document.createElement('span');point.style.cssText='position:absolute;left:50%;top:50%;width:17px;height:17px;transform:translate(-50%,-50%);background:#286bc0;border:3px solid white;border-radius:50%;box-shadow:0 0 0 6px #286bc01a';illustration.append(point);
     el.append(illustration);
   });
   await page.screenshot({path:'/private/tmp/deeptruck-help-tracking.png'});
   await page.locator('#help-demo-map').evaluate(el=>el.remove());
   await page.locator('.sidebar [data-view="verifications"]').click();
   await page.screenshot({path:'/private/tmp/deeptruck-help-verifications.png'});
   await page.locator('#history-body .carrier-link').first().click();
   await page.locator('.details-modal').screenshot({path:'/private/tmp/deeptruck-help-documents.png'});
   await page.keyboard.press('Escape');
   await page.locator('.sidebar [data-view="tracking"]').click();
 }
 await page.locator('#new-tracking-button').click();
 await page.locator('#tracking-create-dialog[open]').waitFor();
 await page.locator('#tracking-carrier').selectOption(verification.id);assert.equal(await page.locator('#tracking-driver-phone').inputValue(),'','carrier office phone is never prefilled');
 await page.locator('#tracking-driver-name').fill('Mike Jones');await page.locator('#tracking-driver-phone').fill('+15557654321');
 assert.equal(await page.locator('#tracking-driver-phone').inputValue(),'+15557654321');assert.equal(await page.locator('#tracking-expiry').isVisible(),true);await page.locator('#tracking-load-name').fill('Load #1045 — Test delivery');await page.locator('.tracking-optional summary').click();await page.locator('#tracking-vehicles').fill('Toyota Camry · VIN 1\nHonda Accord · VIN 2');
 await page.locator('#tracking-pickup').fill('Atlanta auction');await page.locator('#tracking-delivery').fill('Miami dealership');
 await page.screenshot({path:'/private/tmp/deeptruck-tracking-create.png'});
 if(process.env.HELP_SCREENSHOTS){
   await page.setViewportSize({width:1440,height:1400});
   await page.locator('#tracking-create-dialog').screenshot({path:'/private/tmp/deeptruck-help-create.png'});
   await page.setViewportSize({width:1440,height:1000});
 }
 failCreateNetwork=true;
 await page.locator('#tracking-create-submit').click();
 await page.waitForFunction(()=>document.getElementById('tracking-create-message').textContent.includes('Could not connect to tracking'));
 assert.equal(await page.locator('#tracking-create-dialog').evaluate(el=>el.open),true);
 assert.equal(await page.locator('#tracking-driver-phone').inputValue(),'+15557654321');
 assert.equal(await page.locator('#tracking-load-name').inputValue(),'Load #1045 — Test delivery');
 assert.equal(await page.locator('#tracking-create-submit').isEnabled(),true);assert.equal(requests.length,1);
 failCreateNetwork=false;
 await page.locator('#tracking-create-submit').click();await page.waitForFunction(()=>!document.getElementById('tracking-create-dialog').open);
 await page.waitForFunction(()=>document.getElementById('tracking-action-message').textContent.includes('SMS could not'));
 assert.equal(requests[0].clientRequestId,requests[1].clientRequestId,'failed request retries keep idempotency key');
 assert.equal(created.verificationId,verification.id);assert.equal(created.driverPhone,'+15557654321');assert.equal(created.vehicles.length,2);assert.match(created.clientRequestId,/^[0-9a-f-]{36}$/);
 await page.locator('[data-tracking-action="resend"]').click();await page.waitForFunction(()=>document.getElementById('toast').textContent==='Invitation sent.');
 await page.locator('#tracking-search').fill('Orlando');assert.equal(await page.locator('.tracking-card').count(),1);
 await page.locator('[data-tracking-action="complete"]').click();await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('Load completed'));
 await page.locator('#tracking-search').fill('');await page.locator('[data-tracking-filter=closed]').click();assert.equal(await page.locator('.tracking-card').count(),1);
 await page.locator('[data-tracking-filter=open]').click();
 for(const width of [320,390,768,1024,1440,2048]){
   await page.setViewportSize({width,height:1000});
   for(const view of ['verifications','tracking','billing','settings','help']){
     if(width<=760 && ['billing','settings','help'].includes(view)){await page.locator('#mobile-more>summary').click();await page.locator(`#mobile-more [data-view="${view}"]`).click();}else await page.locator(`.sidebar [data-view="${view}"]`).click();
     assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}px ${view}: horizontal overflow`);
     if([390,1440].includes(width)) await page.screenshot({path:`/private/tmp/deeptruck-workspace-${view}-${width}.png`,fullPage:true});
   }
   await page.locator('.sidebar [data-view="tracking"]').click();
   if(width===390)await page.screenshot({path:'/private/tmp/deeptruck-tracking-mobile.png'});
   await page.locator('#new-tracking-button').click();
   assert.ok(await page.locator('#tracking-create-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth),`${width}px dialog overflow`);
   await page.keyboard.press('Escape');assert.equal(await page.locator('#tracking-create-dialog').evaluate(el=>el.open),false);
   console.log(`PASS ${width}px: five menus, Tracking and creation dialog`);
 }
 await page.locator('.sidebar [data-view="verifications"]').click();await page.locator('#history-body .carrier-link').first().click();
 await page.screenshot({path:"/private/tmp/deeptruck-workspace-documents.png"});await page.locator("#refresh-details").click();await page.waitForFunction(()=>document.getElementById("toast").textContent==="Verification refreshed.");assert.equal(await page.locator("#admin-app").evaluate(el=>el.inert),true);assert.equal(await page.locator("#carrier-detail-title").textContent(),"Northline Transport");assert.equal(await page.locator('.document-card a').count(),3);await page.locator('#create-tracking-from-verification').click();assert.equal(await page.locator('#tracking-carrier').inputValue(),verification.id);
 await page.keyboard.press('Escape');await page.reload();await page.locator('#tracking.active').waitFor();
 failLoads=true;await page.locator('#tracking-refresh').click();await page.waitForFunction(()=>document.getElementById('tracking-message').textContent==='Tracking unavailable');
 assert.ok(await page.locator('.tracking-card').count()>0,'refresh failures preserve prior records');
 failLoads=false;
 await page.locator('.sidebar [data-view="verifications"]').click();
 await page.locator('[data-copy]').first().click();await page.waitForFunction(()=>document.getElementById('toast').textContent==='Carrier link copied.');assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),verification.verificationUrl);
 assert.equal(await page.locator('#history-body tr').count(),2);
 assert.match(await page.locator('#history-body').textContent(),/3\/5 complete/);
 assert.match(await page.locator('#history-body').textContent(),/Waiting: W-9, Insurance/);
 await page.locator('[data-filter=pending]').click();assert.equal(await page.locator('#history-body tr').count(),1);
 await page.locator('[data-filter=all]').click();
 await page.locator('#new-verification-button').click();await page.locator('#dot-input').fill('1234567');await page.locator('#dot-search-button').click();
 await page.locator('[data-action=open-existing]').waitFor();assert.equal(await page.locator('[data-action=send-verification]').count(),0);assert.equal(verificationPosts,0);
 await page.locator('[data-action=open-existing]').click();assert.equal(await page.locator('#carrier-detail-title').textContent(),'Northline Transport');
 await page.keyboard.press('Escape');assert.equal(await page.locator('#admin-app').evaluate(el=>el.inert),false);
 failExisting=true;await page.locator('#new-verification-button').click();await page.locator('#dot-input').fill('1234567');await page.locator('#dot-search-button').click();await page.waitForFunction(()=>document.getElementById('verify-message').textContent.includes('Could not check existing'));assert.equal(await page.locator('[data-action=send-verification]').count(),0);await page.keyboard.press('Escape');failExisting=false;
 await page.locator('#new-verification-button').click();await page.locator('#dot-input').fill('9999999');await page.locator('#dot-search-button').click();await page.locator('[data-action=send-verification]').waitFor();await page.locator('[data-action=send-verification]').click();await page.locator('[data-action=open-existing]').waitFor();assert.equal(verificationPosts,1);await page.keyboard.press('Escape');
 const original=[...verifications];verifications=Array.from({length:25},(_,i)=>({...verification,id:randomUUID(),carrierName:'Carrier '+String(i).padStart(2,'0'),dot:String(3000000+i)}));await page.locator('#refresh-history').click();await page.waitForFunction(()=>document.getElementById('history-count').textContent.includes('of 25'));assert.equal(await page.locator('#history-body tr').count(),20);await page.locator('#next-page').click();assert.equal(await page.locator('#history-body tr').count(),5);await page.locator('#search').fill('Carrier 02');assert.equal(await page.locator('#history-body tr').count(),1);assert.equal(await page.locator('#previous-page').isEnabled(),false);verifications=original;await page.locator('#search').fill('');await page.locator('#refresh-history').click();
 await page.setViewportSize({width:390,height:1000});await page.locator('.sidebar [data-view="tracking"]').click();
 await page.locator('.tracking-card').first().click();assert.equal(await page.locator('#tracking-detail').isVisible(),true);assert.equal(await page.locator('#tracking-list').isVisible(),false);
 await page.locator('#tracking-back').click();assert.equal(await page.locator('#tracking-list').isVisible(),true);
 await page.locator('[data-tracking-filter=attention]').click();assert.equal(await page.locator('.tracking-card').count(),0,'healthy recent loads do not need attention');
 const failed=loads.find(v=>v.status==='pending');failed.invitationStatus='failed';const delayed=loads.find(v=>v.status==='active');delayed.latestLocation.capturedAt=new Date(Date.now()-600000).toISOString();await page.locator('#tracking-refresh').click();await page.waitForFunction(()=>document.getElementById('tracking-attention-count').textContent==='2');assert.equal(await page.locator('.tracking-card').count(),2);
 await page.locator('.tracking-card').first().click();const selectedId=await page.locator('.tracking-card.selected').getAttribute('data-tracking-select');await page.locator('#tracking-refresh').click();assert.equal(await page.locator('.tracking-card.selected').getAttribute('data-tracking-select'),selectedId);assert.equal(await page.locator('#tracking-detail').isVisible(),true);
 await page.goto(origin+'/admin/#history');await page.locator('#verifications.active').waitFor();assert.equal(await page.locator('#page-title').textContent(),'Verifications');
 await page.goto(origin+'/admin/#tracking');await page.locator('#tracking.active').waitFor();await page.setViewportSize({width:1440,height:1000});
 await page.locator('#new-tracking-button').click();await page.locator('#tracking-carrier').selectOption(verification.id);
 await page.locator('#tracking-driver-name').fill('Pickup Driver');await page.locator('#tracking-driver-phone').fill('+15551234570');await page.locator('#tracking-load-name').fill('Protected pickup');
 const edit=page.locator('#tracking-create-documents');await edit.locator('input[type=file]').setInputFiles({name:'Gate pass.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nGate pass fixture\n%%EOF')});
 const countBefore=loads.length,requestsBefore=requests.length;
 await page.locator('#tracking-create-submit').click();await page.waitForFunction(()=>document.getElementById('tracking-create-message').textContent.includes('Confirm the exact'));assert.equal(requests.length,requestsBefore,'no load is created before confirming the pickup');
 await edit.locator('[aria-label="Exact pickup address"]').fill('100 Auction Road, Atlanta GA 30303');await edit.locator('[data-pickup-search]').click();await edit.locator('.pickup-address-result').first().click();await edit.locator('[aria-label="Confirm pickup location"]').check();
 await page.screenshot({path:'/private/tmp/deeptruck-pickup-documents-create.png'});
 documentRequests=[];failUploadOnce=true;await page.locator('#tracking-create-submit').click();await page.waitForFunction(()=>document.getElementById('tracking-create-message').textContent.includes('Load saved.'));
 assert.equal(loads.length,countBefore+1);assert.equal(documentRequests.some(p=>p.endsWith('/resend')),false,'invitation waits for all attachments');
 await page.locator('#tracking-create-submit').click();await page.waitForFunction(()=>!document.getElementById('tracking-create-dialog').open);
 assert.equal(loads.length,countBefore+1,'upload retry does not create another load');assert.equal(requests.length,requestsBefore+1);assert.equal(created.deferInvitation,true);
 await page.locator('.pickup-document-list').waitFor();assert.match(await page.locator('.pickup-documents').textContent(),/Locked/);
 assert.equal(documentRequests.at(-2)?.endsWith('/resend') || documentRequests.some(p=>p.endsWith('/resend')),true);
 await page.locator('[data-pickup-unlock]').click();await page.waitForFunction(()=>document.querySelector('.pickup-documents').textContent.includes('Unlocked by you'));
 assert.match(await page.locator('.pickup-document-list').textContent(),/Available/);assert.equal(await page.locator('[data-pickup-unlock]').count(),0);
 await page.screenshot({path:'/private/tmp/deeptruck-pickup-documents-detail.png'});
 await page.locator('[data-pickup-add]').click();const more=page.locator('.pickup-edit-dialog');await more.locator('input[type=file]').setInputFiles({name:'Release form.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nRelease fixture\n%%EOF')});assert.equal(await more.locator('[aria-label="Exact pickup address"]').inputValue(),'100 Auction Road, Atlanta GA 30303');
 await more.locator('[type=submit]').click();await page.waitForFunction(()=>!document.querySelector('.pickup-edit-dialog'));assert.equal(await page.locator('.pickup-document-list li').count(),2);
 for(const width of [320,390,768,1440]){
   await page.setViewportSize({width,height:1000});if(width<=760 && !await page.locator('#tracking-detail').isVisible())await page.locator('.tracking-card.selected').click();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),width+'px pickup documents overflow');
   await page.locator('[data-pickup-add]').click();const panel=page.locator('.pickup-edit-dialog');await panel.locator('input[type=file]').setInputFiles({name:'Release form.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nFixture\n%%EOF')});
   assert.ok(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth),width+'px pickup editor overflow');
   if(width===390)await panel.screenshot({path:'/private/tmp/deeptruck-pickup-documents-mobile.png'});await page.keyboard.press('Escape');
 }
 const inspectionLoad=loads.find(v=>v.title==='Protected pickup');inspectionLoad.pickupDocuments.documents[0].inspection={id:'inspection',status:'completed',damageCount:1,completedAt:new Date().toISOString()};
 await page.locator('#tracking-refresh').click();await page.locator('[data-pickup-inspection]').waitFor();
 for(const width of [320,390,1440]){
   await page.setViewportSize({width,height:1000});await page.locator('[data-pickup-inspection]').click();const inspection=page.locator('.inspection-dialog');await inspection.locator('code').waitFor();
   assert.equal(await inspection.locator('code').textContent(),'10-12-3');assert.equal(await inspection.locator('.inspection-photos img').count(),1);assert.equal(await inspection.locator('[data-inspection-pdf]').count(),1);assert.ok(await inspection.evaluate(el=>el.scrollWidth<=el.clientWidth),width+'px inspection overflow');
   if(width===390)await inspection.screenshot({path:'/private/tmp/deeptruck-admin-inspection.png'});await page.keyboard.press('Escape');
 }
 console.log('PASS owner inspection details, codes, photo thumbnails and annotated PDF controls at 320/390/1440px');
 console.log('PASS pickup pin confirmation, one-mile map, uploads before invitation, safe upload retry, manual unlock and attachments on existing loads');
 await page.goto(origin+'/driver/?invite='+loads[0].id);assert.equal(await page.locator('#open-driver').getAttribute('href'),'deeptruck-driver://loads?invite='+loads[0].id);
 await page.waitForFunction(()=>document.getElementById('install-status').textContent.includes('pilot testing'));
 assert.deepEqual(errors,[]);console.log('PASS merged workspace, progress, lookup reuse, new verification, clipboard, drawer refresh, pagination, attention filters, mobile navigation, invitation retries and tracking handoff');
 await ctx.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
