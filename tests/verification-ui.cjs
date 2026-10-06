const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const origin = 'https://verification.test';
const api = 'https://yqpeebgmqtqoxumzfrsq.supabase.co/functions/v1/carrier-verify';
const initial = {id:'fixture',carrierName:'Northline Transport',dot:'1234567',mc:'MC123456',email:'dispatch@example.com',phone:'2025550148',emailVerified:false,phoneVerified:false,licenseUploaded:false,w9Uploaded:false,coiUploaded:false};
(async () => {
  const executable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
  const browser = await chromium.launch({headless:true,...(executable ? {executablePath:executable} : {})});
  try {
    const context = await browser.newContext({viewport:{width:1366,height:768}});
    let record = {...initial}, failUpload = false, failLoad = false;
    const errors=[],uploads=[];
    await context.route(origin+'/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      const file = path.join(root,'public',pathname === '/verify' ? 'verify.html' : pathname);
      if (!file.startsWith(path.join(root,'public')) || !fs.existsSync(file)) return route.fulfill({status:404,body:'Not found'});
      const types={'.html':'text/html','.css':'text/css','.js':'application/javascript','.svg':'image/svg+xml'};
      return route.fulfill({contentType:types[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
    });
    await context.route(api+'/**', async route => {
      const req=route.request(),pathname=new URL(req.url()).pathname;
      const respond=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
      if(req.method()==='GET')return failLoad ? respond({error:'This verification could not be loaded.'},503) : respond(record);
      const action=pathname.split('/').at(-1),body=req.postDataJSON();
      if(action==='email')record.emailVerified=true;
      else if(action==='phone') {
        if(body.code!=='123456')return respond({error:'Invalid SMS code. Please try again.'},400);
        record.phoneVerified=true;
      } else {
        uploads.push({action,...body});
        if(failUpload)return respond({error:'Upload failed. Please retry.'},503);
        record[action+'Uploaded']=true;record[action+'FileName']=body.fileName;
      }
      return respond(record);
    });
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    const checkScreen=async label=>{
      const size=await page.evaluate(()=>({height:Math.max(document.body.scrollHeight,document.documentElement.scrollHeight),width:document.documentElement.scrollWidth,viewportHeight:innerHeight,viewportWidth:innerWidth}));
      if(size.height>size.viewportHeight){await page.screenshot({path:'/private/tmp/deeptruck-verify-overflow.png',fullPage:true});console.log(await page.locator('#verify-phone').evaluate(el=>({className:el.className,background:getComputedStyle(el).backgroundColor})));console.log(await page.evaluate(()=>Object.fromEntries(['.site-header','.page-heading','.carrier-card','.verify','.checklist-heading','.flow','.completion-message','.page-footer'].map(selector=>[selector,Math.round(document.querySelector(selector).getBoundingClientRect().height)]))));}
      assert.ok(size.height<=size.viewportHeight,`${label}: ${size.height}px page exceeds ${size.viewportHeight}px screen`);
      assert.ok(size.width<=size.viewportWidth,`${label}: horizontal overflow`);
      for(const id of ['code','verify-phone','upload-license','upload-w9','upload-coi']) {
        const node=page.locator('#'+id);if(!await node.isVisible())continue;
        const bounds=await node.boundingBox();assert.ok(bounds.y>=0 && bounds.y+bounds.height<=size.viewportHeight,`${label}: ${id} outside visible screen`);
      }
    };
    for(const [width,height] of [[1366,768],[1280,720],[1024,640],[1440,900],[390,844],[375,812],[360,740],[320,700]]) {
      await page.setViewportSize({width,height});
      for(const complete of [false,true]) {
        record={...initial,emailVerified:true,phoneVerified:complete,licenseUploaded:complete,w9Uploaded:complete,coiUploaded:complete,...(complete?{licenseFileName:'Driver-license-sofia-logistics-2026-final.pdf',w9FileName:'Signed-W9-sofia-logistics-2026.pdf',coiFileName:'Certificate-of-insurance-2026-2027.pdf'}:{})};
        await page.goto(origin+'/verify?id=fixture');await page.waitForFunction(()=>document.getElementById('status-pill').textContent!=='Loading');
        await checkScreen(`${width}×${height} ${complete?'complete':'pending'}`);
        if(!complete)assert.ok(await page.locator('#code').evaluate(el=>{const style=getComputedStyle(el),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font=style.font;return ctx.measureText('123456').width<=el.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);}),`${width}px: all six code digits fit`);
        if([1366,390].includes(width)){await page.waitForTimeout(250);await page.screenshot({path:`/private/tmp/deeptruck-verify-light-${width}-${complete?'complete':'pending'}.png`});}
      }
      console.log(`PASS ${width}×${height}: all five steps visible without scrolling`);
    }
    await page.setViewportSize({width:1280,height:720});record={...initial};await page.goto(origin+'/verify?id=fixture');
    await page.waitForFunction(()=>document.getElementById('progress-label').textContent==='1 of 5 complete');
    await page.locator('#code').fill('999999');await page.locator('#verify-phone').click();await page.waitForFunction(()=>document.getElementById('phone-msg').textContent.includes('Invalid SMS'));
    assert.equal(await page.locator('#verify-phone').isEnabled(),true);await checkScreen('SMS error');
    await page.locator('#code').fill('123456');await page.locator('#verify-phone').click();await page.waitForFunction(()=>document.getElementById('progress-label').textContent==='2 of 5 complete');
    for(const type of ['license','w9','coi']) {
      await page.locator('#'+type).setInputFiles({name:type+'.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 fixture')});
      await page.waitForFunction(type=>document.getElementById(type+'-label').textContent==='Replace file',type);
      assert.equal(await page.locator('#'+type).isEnabled(),true);
    }
    assert.equal(uploads.length,3);assert.ok(uploads.every(v=>v.fileData.startsWith('data:application/pdf;base64,')));
    assert.equal(await page.locator('#completion-message').isVisible(),true);await checkScreen('completed upload flow');
    failUpload=true;await page.locator('#w9').setInputFiles({name:'replacement.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF fixture')});await page.waitForFunction(()=>document.getElementById('w9-msg').textContent.includes('Upload failed'));
    assert.equal(await page.locator('#w9').isEnabled(),true);assert.equal(record.w9FileName,'w9.pdf');await checkScreen('replacement failure');
    failUpload=false;await page.locator('#w9').setInputFiles({name:'replacement.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF fixture')});await page.waitForFunction(()=>document.getElementById('w9-msg').textContent==='replacement.pdf');
    failLoad=true;await page.reload();await page.waitForFunction(()=>!document.getElementById('page-message').hidden);assert.equal(await page.locator('#license').isEnabled(),false);assert.equal(await page.locator('#verify-phone').isEnabled(),false);
    assert.deepEqual(errors,[]);console.log('PASS SMS errors/retry, automatic email confirmation, three document uploads, replacement retry and load errors');
    await context.close();
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exit(1);});
