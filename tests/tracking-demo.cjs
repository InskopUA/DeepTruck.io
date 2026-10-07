const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),contrast=require('./ui-contrast.cjs');
const root=path.resolve(__dirname,'../verify-site'),origin='https://demo.deeptruck.test';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{
  const ctx=await browser.newContext({reducedMotion:'no-preference'}),errors=[];
  await ctx.route(origin+'/**',route=>{
   const name=new URL(route.request().url()).pathname,file=path.join(root,name==='/'?'index.html':name);
   if(!fs.existsSync(file))return route.fulfill({status:404});
   const types={'.html':'text/html','.css':'text/css','.js':'application/javascript','.svg':'image/svg+xml','.mp4':'video/mp4'};
   return route.fulfill({contentType:types[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
  });
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));await page.clock.install({time:new Date('2026-10-07T12:00:00Z')});await page.clock.pauseAt(new Date('2026-10-07T12:00:01Z'));
  const position=()=>page.locator('[data-demo-truck]').getAttribute('transform');
  const state=()=>page.locator('.tracking-preview').getAttribute('data-demo-state');
  for(const width of [1920,1440,768,390,320]){
   await page.setViewportSize({width,height:900});
   for(const theme of ['dark','light']){
    await page.goto(origin);await page.evaluate(value=>{localStorage.setItem('deeptruck.theme',value);},theme);await page.reload();
    await page.locator('.tracking-preview').scrollIntoViewIfNeeded();await page.locator('.tracking-preview[data-demo-running="true"]').waitFor();await page.clock.runFor(100);
    assert.equal(await state(),'ready');assert.equal(await page.locator('[data-demo-action]').textContent(),'Start tracking');
    const initial=await position();await page.clock.runFor(1150);assert.equal(await state(),'pressing');assert.equal(await position(),initial,'truck stays at pickup until the phone starts sharing');
    await page.clock.runFor(450);assert.equal(await state(),'sharing');assert.equal(await page.locator('[data-demo-action]').textContent(),'Pause tracking');
    assert.equal(await page.locator('[data-demo-phone-status]').textContent(),'Location sharing on');
    const before=await position();await page.locator('.tracking-phone').hover();await page.clock.runFor(1800);assert.notEqual(await position(),before,'truck advances even when phone preview is hovered');
    assert.equal(await page.locator('.tracking-location-icon').evaluate(el=>getComputedStyle(el,'::after').animationName),'tracking-location-pulse');
    const current=await contrast(page,'#driver-tracking');assert.deepEqual(current,[],width+' '+theme+' sharing contrast');
    if([1920,1440,390].includes(width))await page.locator('.tracking-layout').screenshot({path:'/private/tmp/deeptruck-tracking-animated-'+theme+'-'+width+'.png'});
    await page.clock.runFor(5600);assert.equal(await state(),'delivered');assert.equal(await page.locator('[data-demo-action]').textContent(),'Delivery complete');
    const endpoint=await page.locator('[data-demo-route]').evaluate(p=>{const end=p.getPointAtLength(p.getTotalLength());return {x:end.x,y:end.y};});
    const final=await page.locator('[data-demo-truck]').evaluate(t=>{const m=t.transform.baseVal.consolidate().matrix;return {x:m.e,y:m.f};});assert.ok(Math.abs(final.x-endpoint.x)<.01&&Math.abs(final.y-endpoint.y)<.01,'truck reaches delivery');
    const truck=await page.locator('.tracking-truck-disc').boundingBox(),phone=await page.locator('.tracking-phone').boundingBox();
    assert.ok(truck.x+truck.width<=phone.x || truck.y+truck.height<=phone.y,'phone does not hide the destination truck');
    const card=await page.locator('.tracking-layout').boundingBox(),preview=await page.locator('.tracking-preview').boundingBox();
    if(width>=761) assert.ok(Math.abs(preview.width-card.width)<1,'desktop tracking scene uses the full content width');
    assert.ok(phone.x>=card.x && phone.x+phone.width<=card.x+card.width && phone.y>=preview.y && phone.y+phone.height<=preview.y+preview.height,'phone stays inside the visual scene');
    const heading=await page.locator('.tracking-copy').boundingBox();assert.ok(heading.y+heading.height<=preview.y,'headline is above the scene');
    const surface=await page.locator('.tracking-layout').evaluate(el=>{const s=getComputedStyle(el);return {border:s.borderTopWidth,background:s.backgroundColor,shadow:s.boxShadow};});assert.deepEqual(surface,{border:'0px',background:'rgba(0, 0, 0, 0)',shadow:'none'},'tracking is an open scene, not another card');
    const destination=await page.locator('.tracking-map-delivery').boundingBox();
    assert.ok(destination.y+destination.height<=truck.y,'delivery label sits above the truck');
    await page.clock.runFor(1900);assert.equal(await state(),'ready');assert.equal(await position(),initial,'demo resets for the next invitation');
    await page.clock.runFor(2000);await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await page.clock.runFor(100);
    await page.locator('.tracking-preview.demo-offscreen').waitFor();const paused=await position();await page.clock.runFor(2000);assert.equal(await position(),paused,'offscreen demo does not keep rendering');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const sizes=await page.evaluate(()=>['#tracking-title','#pricing .section-title'].map(s=>getComputedStyle(document.querySelector(s)).fontSize));assert.equal(sizes[0],sizes[1],'tracking uses the established section heading size');
   }
   console.log('PASS '+width+'px: synchronized tap, sharing pulse, truck route, delivery, looping and both themes');
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  for(const [width,height] of [[1920,1080],[1470,807],[1366,768],[1280,720],[1920,720],[1440,600],[1024,768],[768,900]]){
    await page.setViewportSize({width,height});
    for(const theme of ['dark','light']){
      await page.goto(origin);await page.evaluate(value=>localStorage.setItem('deeptruck.theme',value),theme);await page.reload();
      await page.evaluate(()=>{
        document.querySelectorAll('.reveal').forEach(el=>el.classList.add('visible'));
        document.querySelector('#driver-tracking').scrollIntoView({block:'start',behavior:'instant'});
      });
      await page.clock.runFor(200);
      const nav=await page.locator('.nav').boundingBox(),heading=await page.locator('.tracking-copy').boundingBox(),actions=await page.locator('.tracking-actions').boundingBox();
      assert.ok(heading.y>=nav.y+nav.height,'tracking heading clears the fixed navigation');
      assert.ok(actions.y+actions.height<=height-1,`${width}x${height} ${theme}: both CTAs and consent line fit in the viewport`);
      const phone=await page.locator('.tracking-phone').boundingBox(),scene=await page.locator('.tracking-preview').boundingBox(),map=await page.locator('.tracking-map').boundingBox();
      assert.ok(phone.y>=scene.y&&phone.y+phone.height<=scene.y+scene.height,'resized phone stays above the CTAs');
      const badge=await page.locator('.tracking-live').boundingBox();assert.ok(badge.y+badge.height<=phone.y,'phone stays below the sharing badge on short screens');
      for(const label of ['.tracking-map-pickup','.tracking-map-delivery']){
        const box=await page.locator(label).boundingBox();assert.ok(box.y>=map.y&&box.y+box.height<=map.y+map.height,'route labels are not clipped on short screens');
      }
      const marker=await page.locator('.tracking-truck-disc').boundingBox();assert.ok(Math.abs(marker.width-marker.height)<1,'wide map keeps the truck marker circular');
      const destination=await page.locator('.tracking-map-delivery').boundingBox();
      assert.ok(destination.x+destination.width<=phone.x||destination.y+destination.height<=phone.y,'phone does not obscure the delivery label');
      assert.deepEqual(await contrast(page,'#driver-tracking'),[]);
      if(width===1470||height===600)await page.screenshot({path:`/private/tmp/deeptruck-tracking-viewport-${theme}-${width}x${height}.png`});
      console.log(`PASS ${width}x${height} ${theme}: complete section, CTAs and map fit below navigation`);
    }
  }
  await page.locator('.tracking-preview').scrollIntoViewIfNeeded();await page.clock.runFor(100);assert.equal(await state(),'sharing');const staticPoint=await position();await page.clock.runFor(6000);assert.equal(await position(),staticPoint);assert.equal(await page.locator('.tracking-location-icon').evaluate(el=>getComputedStyle(el,'::after').animationName),'none');
  assert.deepEqual(errors,[]);console.log('PASS reduced motion shows a stable sharing preview');await ctx.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
