const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{chromium}=require('playwright'),contrast=require('./ui-contrast.cjs');
const root=path.resolve(__dirname,'../verify-site'),origin='https://damage.deeptruck.test';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{
  const ctx=await browser.newContext(),errors=[];
  await ctx.route(origin+'/**',route=>{const name=new URL(route.request().url()).pathname,file=path.join(root,name==='/'?'index.html':name);if(!fs.existsSync(file))return route.fulfill({status:404});const types={'.html':'text/html','.css':'text/css','.js':'application/javascript','.svg':'image/svg+xml','.png':'image/png','.mp4':'video/mp4'};return route.fulfill({contentType:types[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});});
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));await page.clock.install({time:new Date('2026-10-07T12:00:00Z')});await page.clock.pauseAt(new Date('2026-10-07T12:00:01Z'));
  for(const width of [1920,1440,1280,960,768,390,320])for(const theme of ['dark','light']){
    await page.setViewportSize({width,height:900});await page.goto(origin);await page.evaluate(t=>localStorage.setItem('deeptruck.theme',t),theme);await page.reload();
    await page.locator('.damage-phone').scrollIntoViewIfNeeded();await page.locator('.damage-demo[data-damage-running="true"]').waitFor();await page.clock.runFor(100);
    await page.addStyleTag({content:'#pickup-damage .reveal {opacity:1!important;transform:none!important}'});
    assert.equal(await page.locator('#pickup-damage + section').getAttribute('id'),'reviews','placed immediately before reviews');
    assert.equal(await page.locator('.damage-example').count(),3,'three separate examples');
    const phases=[['idle',0],['opening',1800],['inspecting',1000],['selecting',1400],['sizing',1500],['photo',1800],['notes',2600],['printing',2000],['delivered',3500]];
    let traveled=100;
    for(const [state,advance] of phases){
      if(advance){await page.clock.runFor(advance);traveled+=advance;}
      assert.equal(await page.locator('.damage-demo').getAttribute('data-damage-state'),state,`${width} ${theme} ${state}`);
      await page.addStyleTag({content:'#pickup-damage * {transition:none!important}'});
      assert.deepEqual(await contrast(page,'#pickup-damage'),[],`${width} ${theme} ${state}: text contrast`);
      if(state==='sizing'){const sizes=await page.locator('.damage-size-row').boundingBox(),action=await page.locator('.damage-camera-control').boundingBox();assert.ok(sizes.y+sizes.height<action.y,'damage size choices remain above the photo action');}
      if(state==='opening')await page.locator('.damage-phone').hover();
      if(state==='notes')assert.equal(await page.locator('.damage-note-result').evaluate(el=>getComputedStyle(el).opacity),'1','actual annotated gate pass appears');
      if(state==='delivered')assert.equal(await page.locator('.damage-print-receipt').evaluate(el=>getComputedStyle(el).opacity),'1','printed copy for guard check');
    }
    await page.locator('.damage-printed-paper img').scrollIntoViewIfNeeded();await page.locator('.damage-note-result').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#pickup-damage img').evaluateAll(images=>images.every(img=>img.complete&&img.naturalWidth>0)),true,'all document images loaded');
    const sizes=await page.evaluate(()=>['#damage-title','#reviews .section-title'].map(s=>getComputedStyle(document.querySelector(s)).fontSize));assert.equal(sizes[0],sizes[1],'established heading size');
    const styles=await page.evaluate(()=>['.damage-actions .btn-primary','.tracking-action-buttons .btn-primary'].map(s=>{const c=getComputedStyle(document.querySelector(s));return [c.fontFamily,c.fontSize,c.fontWeight,c.backgroundColor,c.borderColor,c.borderRadius];}));assert.deepEqual(styles[0],styles[1],'existing CTA styles');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width} ${theme}: horizontal overflow`);
    const examples=await page.locator('.damage-example').evaluateAll(cards=>cards.map(el=>{const b=el.getBoundingClientRect();return {x:b.x,y:b.y,right:b.right,bottom:b.bottom};}));
    if(width>900)assert.ok(examples[0].right<examples[1].x&&examples[1].right<examples[2].x,'left to right desktop flow');
    else assert.ok(examples[0].bottom<examples[1].y&&examples[1].bottom<examples[2].y,'stacked mobile flow');
    for(const [item,sceneSelector] of [['.damage-phone','.damage-phone-scene'],['.damage-paper','.damage-document-scene'],['.damage-print-window','.damage-print-scene']]){
      const b=await page.locator(item).boundingBox(),scene=await page.locator(sceneSelector).boundingBox();
      assert.ok(b.x>=scene.x-5&&b.x+b.width<=scene.x+scene.width+5&&b.y>=scene.y-5&&b.y+b.height<=scene.y+scene.height+5,`${width} ${theme} ${item}: stays inside example`);
    }
    const camera=await page.locator('.damage-camera-control').boundingBox(),home=await page.locator('.damage-phone-home').boundingBox();assert.ok(camera.y+camera.height<home.y,`${width}: app action does not overlap home indicator ${JSON.stringify({camera,home})}`);
    if([1920,1440,390,320].includes(width))await page.locator('#pickup-damage').screenshot({path:`/private/tmp/deeptruck-damage-site-${theme}-${width}.png`,style:".nav-wrap {visibility:hidden!important}"});
    await page.clock.runFor(19000-traveled+100);assert.equal(await page.locator('.damage-demo').getAttribute('data-damage-state'),'idle','workflow loops and continues on hover');
    console.log(`PASS ${width}px ${theme}: inspection → real gate pass → printed copy; contrast and layout`);
  }
  await page.emulateMedia({reducedMotion:'reduce'});await page.reload();await page.locator('#pickup-damage').scrollIntoViewIfNeeded();await page.clock.runFor(100);assert.equal(await page.locator('.damage-demo').getAttribute('data-damage-state'),'delivered');await page.clock.runFor(25000);assert.equal(await page.locator('.damage-demo').getAttribute('data-damage-state'),'delivered');
  assert.deepEqual(errors,[]);console.log('PASS stable completed workflow with reduced motion');await ctx.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
