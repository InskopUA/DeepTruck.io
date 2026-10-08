const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{chromium}=require('playwright'),contrast=require('./ui-contrast.cjs');
const root=path.resolve(__dirname,'../verify-site'),origin='https://damage.deeptruck.test';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{
  const ctx=await browser.newContext(),errors=[];
  await ctx.route(origin+'/**',route=>{const name=new URL(route.request().url()).pathname,file=path.join(root,name==='/'?'index.html':name);if(!fs.existsSync(file))return route.fulfill({status:404});const types={'.html':'text/html','.css':'text/css','.js':'application/javascript','.svg':'image/svg+xml','.mp4':'video/mp4'};return route.fulfill({contentType:types[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});});
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));await page.clock.install({time:new Date('2026-10-07T12:00:00Z')});await page.clock.pauseAt(new Date('2026-10-07T12:00:01Z'));
  for(const width of [1920,1440,1280,768,390,320])for(const theme of ['dark','light']){
    await page.setViewportSize({width,height:900});await page.goto(origin);await page.evaluate(t=>localStorage.setItem('deeptruck.theme',t),theme);await page.reload();
    await page.locator('.damage-demo').scrollIntoViewIfNeeded();await page.locator('.damage-demo[data-damage-running="true"]').waitFor();await page.clock.runFor(150);
    assert.equal(await page.locator('#pickup-damage + section').getAttribute('id'),'reviews','placed immediately before reviews');
    assert.equal(await page.locator('.damage-demo').getAttribute('data-damage-state'),'idle');await page.clock.runFor(1800);assert.equal(await page.locator('.damage-demo').getAttribute('data-damage-state'),'selecting');
    await page.locator('.damage-picker').hover();await page.clock.runFor(2600);assert.equal(await page.locator('.damage-demo').getAttribute('data-damage-state'),'photo','hover keeps the demo moving');
    await page.clock.runFor(3000);assert.equal(await page.locator('.damage-demo').getAttribute('data-damage-state'),'ready');
    await page.addStyleTag({content:'#pickup-damage * {transition:none!important} #pickup-damage .reveal {opacity:1!important;transform:none!important}'});
    assert.equal(await page.locator('.damage-note-result').evaluate(el=>getComputedStyle(el).opacity),'1');assert.equal(await page.locator('.damage-photo-qr img').evaluate(el=>el.complete&&el.naturalWidth>0),true);
    assert.deepEqual(await contrast(page,'#pickup-damage'),[],width+' '+theme+' text contrast');
    const sizes=await page.evaluate(()=>['#damage-title','#reviews .section-title'].map(s=>getComputedStyle(document.querySelector(s)).fontSize));assert.equal(sizes[0],sizes[1],'established heading size');
    const styles=await page.evaluate(()=>['.damage-actions .btn-primary','.tracking-action-buttons .btn-primary'].map(s=>{const c=getComputedStyle(document.querySelector(s));return [c.fontFamily,c.fontSize,c.fontWeight,c.backgroundColor,c.borderColor,c.borderRadius];}));assert.deepEqual(styles[0],styles[1],'existing CTA styles');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),width+' '+theme+' horizontal overflow');
    if([1920,1440,390,320].includes(width))await page.locator('#pickup-damage').screenshot({path:`/private/tmp/deeptruck-damage-site-${theme}-${width}.png`});
    const paper=await page.locator('.damage-paper').boundingBox(),note=await page.locator('.damage-notes').boundingBox(),picker=await page.locator('.damage-picker').boundingBox();assert.ok(picker.y+picker.height<=note.y||picker.x+picker.width<=note.x,`${width} ${theme}: diagram does not cover recorded damage codes ${JSON.stringify({picker,note})}`);
    const scene=await page.locator('.damage-scene').boundingBox();assert.ok(paper.y>=scene.y-12&&paper.y+paper.height<=scene.y+scene.height+12,`${width} ${theme}: paper stays inside the illustration ${JSON.stringify({paper,scene})}`);
    if([1440,390,320].includes(width))await page.locator('#pickup-damage').screenshot({path:`/private/tmp/deeptruck-damage-site-${theme}-${width}.png`});
    await page.clock.runFor(4000);assert.equal(await page.locator('.damage-demo').getAttribute('data-damage-state'),'idle','demo loops');
    console.log(`PASS ${width}px ${theme}: damage demo, CTA consistency, readable text and layout`);
  }
  await page.emulateMedia({reducedMotion:'reduce'});await page.reload();await page.locator('#pickup-damage').scrollIntoViewIfNeeded();await page.clock.runFor(100);assert.equal(await page.locator('.damage-demo').getAttribute('data-damage-state'),'ready');await page.clock.runFor(15000);assert.equal(await page.locator('.damage-demo').getAttribute('data-damage-state'),'ready');
  assert.deepEqual(errors,[]);console.log('PASS stable completed preview with reduced motion');await ctx.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
