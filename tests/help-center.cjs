const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {chromium} = require('playwright');
const contrast = require('./ui-contrast.cjs');
const {articles} = require('../scripts/help-content.cjs');
const root = path.resolve(__dirname,'../public'), origin='https://help.deeptruck.test';
(async () => {
  const browser = await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  try {
    const context = await browser.newContext({viewport:{width:1440,height:960},reducedMotion:'reduce',permissions:['clipboard-read','clipboard-write']});
    const errors = [],missing=[];
    let failSearch=false;
    await context.route(origin+'/**',route => {
      let pathname = new URL(route.request().url()).pathname;
      if(pathname==='/help/search-index.json' && failSearch) return route.fulfill({status:503});
      if(pathname==='/' || pathname==='/help' || pathname==='/help/') pathname=pathname==='/'?'/index.html':'/help/index.html';
      else if(!path.extname(pathname)) pathname += '.html';
      const file=path.resolve(root,'.'+pathname);
      if(!file.startsWith(root+path.sep) || !fs.existsSync(file)){missing.push(pathname);return route.fulfill({status:404});}
      const types={'.html':'text/html','.css':'text/css','.js':'application/javascript','.json':'application/json','.svg':'image/svg+xml','.jpg':'image/jpeg','.png':'image/png'};
      return route.fulfill({contentType:types[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
    });
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    const check=async label=>{
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+': page overflow');
      const failures=await contrast(page);assert.deepEqual(failures,[],label+': text contrast');
      const broken=await page.locator('main img').evaluateAll(images=>images.filter(i=>i.complete&&!i.naturalWidth).map(i=>i.src));assert.deepEqual(broken,[],label+': missing screenshot');
    };
    await page.goto(origin+'/help');
    for(const theme of ['light','dark']){
      await page.evaluate(value=>localStorage.setItem('deeptruck.theme',value),theme);
      await page.setViewportSize({width:1440,height:960});
      for(const slug of ['',...articles.map(a=>a.slug)]){
        await page.goto(origin+'/help'+(slug?'/'+slug:''));
        assert.equal(await page.locator('html').getAttribute('data-theme'),theme);
        assert.equal(await page.locator('h1').count(),1);
        await check(theme+' '+(slug||'home'));
        const invalid=await page.locator('main a[href^="#"],.contents-rail nav a').evaluateAll(links=>links.filter(a=>!document.getElementById(a.hash.slice(1))).map(a=>a.href));assert.deepEqual(invalid,[]);
        if(slug)assert.equal(await page.locator('.nav-group a[aria-current="page"]').count(),1);
        if(['','location-permissions','create-tracking','pickup-documents','record-pickup-damage','review-damage-notes'].includes(slug))await page.screenshot({path:'/private/tmp/deeptruck-help-'+(slug||'home')+'-'+theme+'.png',fullPage:true});
      }
      console.log('PASS '+theme+': all '+articles.length+' articles, text contrast and section links');
    }
    for(const width of [320,390,768,1024]){
      await page.setViewportSize({width,height:844});
      for(const slug of ['','create-tracking','location-permissions','troubleshooting','pickup-documents','driver-pickup-documents','record-pickup-damage','review-damage-notes']){
        await page.goto(origin+'/help'+(slug?'/'+slug:''));
        const theme=page.getByRole('switch',{name:'Light theme'});
        await theme.click();await check(width+' light '+slug);await theme.click();await check(width+' dark '+slug);
        if(width===390&&['','location-permissions'].includes(slug)){await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);});await page.screenshot({path:'/private/tmp/deeptruck-help-'+(slug||'home')+'-mobile.png',fullPage:true});}
      }
      if(width<761){
        await page.locator('.menu-toggle').click();assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'),'true');
        assert.equal(await page.locator('#guide-nav').isVisible(),true);await check(width+' mobile navigation');
        await page.keyboard.press('Escape');assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'),'false');
        await page.locator('.menu-toggle').click();await page.locator('#guide-nav a[href="/help/accept-load"]').click();await page.waitForURL('**/help/accept-load');assert.equal(await page.locator('h1').textContent(),'Accept a load & start tracking');
      }
      console.log('PASS '+width+'px: home, articles, tables and mobile menu');
    }
    await page.setViewportSize({width:1440,height:960});await page.goto(origin+'/help');
    await page.keyboard.press('Control+k');await page.locator('#search-dialog[open]').waitFor();
    await page.locator('#guide-search').fill('Always');await page.waitForFunction(()=>document.querySelector('.search-result strong')?.textContent==='Set up location: Always on iPhone');
    await check('search dialog');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await page.waitForURL('**/help/location-permissions');
    await page.locator('[data-zoom]').first().click();await page.locator('#image-dialog[open]').waitFor();assert.ok(await page.locator('#zoom-image').evaluate(i=>i.complete&&i.naturalWidth));await page.keyboard.press('Escape');
    await page.locator('#copy-guide').click();await page.waitForFunction(()=>document.getElementById('copy-status').textContent==='Link copied');assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),origin+'/help/location-permissions');
    await page.locator('.contents-rail a[href="#iphone"]').click();assert.ok(await page.locator('#iphone').evaluate(h=>h.getBoundingClientRect().top>=70));
    await page.keyboard.press('Control+k');await page.locator('#guide-search').fill('no-matching-topic-xyz');await page.locator('.search-empty').waitFor();assert.equal(await page.locator('#search-results .search-result').count(),0);
    await page.keyboard.press('Escape');assert.equal(await page.locator('#search-dialog').evaluate(d=>d.open),false);
    for(const [query,slug] of [['unlock pickup','pickup-documents'],['record damage Manheim','record-pickup-damage'],['photos PDF','review-damage-notes'],['gate pass pickup','driver-pickup-documents']]){
      await page.goto(origin+'/help?q='+encodeURIComponent(query));await page.locator('#search-dialog[open]').waitFor();await page.locator('#search-results a[href="/help/'+slug+'"]').waitFor();await page.keyboard.press('Escape');
    }
    await page.goto(origin+'/help?q=SMS');await page.locator('#search-dialog[open]').waitFor();await page.locator('.search-result').first().waitFor();
    await page.goto(origin+'/help');failSearch=true;await page.locator('[data-search-open]').first().click();await page.getByRole('button',{name:'Retry search'}).waitFor();failSearch=false;await page.getByRole('button',{name:'Retry search'}).click();await page.locator('.search-result').first().waitFor();await page.keyboard.press('Escape');
    await page.getByRole('switch',{name:'Light theme'}).click();const selected=await page.locator('html').getAttribute('data-theme');await page.goto(origin+'/help/driver-sign-in');assert.equal(await page.locator('html').getAttribute('data-theme'),selected);
    // Every local documentation destination exists before publishing.
    for(const article of articles){
      const html=fs.readFileSync(path.join(root,'help',article.slug+'.html'),'utf8');
      for(const match of html.matchAll(/(?:href|src)="(\/[^"?#]*)/g)){
        let destination=match[1];if(destination==='/help')destination+='/index.html';else if(destination==='/')destination+='index.html';else if(destination==='/admin/')destination+='index.html';else if(['/login','/signup'].includes(destination))destination='/admin'+destination+'.html';else if(!path.extname(destination))destination+='.html';
        assert.ok(fs.existsSync(path.join(root,destination)),'Missing guide link: '+match[1]);
      }
    }
    assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
    console.log('PASS search, keyboard, empty/retry states, deep links, screenshot zoom, clipboard, theme persistence and all internal links');
    await context.close();
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
