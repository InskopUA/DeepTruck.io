const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {app,loadDriver}=require('./driver-module.cjs'),{chromium}=require('playwright');
const React=require(path.join(app,'node_modules/react')),ReactDOM=require(path.join(app,'node_modules/react-dom/server')),RN=require(path.join(app,'node_modules/react-native-web'));
const mocks={'react-native':{...RN,Platform:{...RN.Platform,OS:'ios'},Modal:({visible,children})=>visible?React.createElement(RN.View,{style:{position:'absolute',inset:0,zIndex:10}},children):null},'react-native-safe-area-context':{SafeAreaView:({children,style})=>React.createElement(RN.View,{style:[style,{paddingTop:44}]},children),useSafeAreaInsets:()=>({top:44,bottom:20,left:0,right:0})}};
const {DriverScreen}=loadDriver('src/DriverScreen.tsx',mocks);
const noop=()=>{},asyncNoop=async()=>{};
const fixture={id:'11111111-1111-4111-8111-111111111111',title:'Load #1042 · Miami',dealerName:'Northline Motors',carrierName:'Northline Transport',carrierDot:'1234567',driverName:'John Smith',driverPhone:'+15551234567',status:'pending',vehicles:['2025 BMW X5'],pickupAddress:'Atlanta auction · Atlanta, GA',deliveryAddress:'Northline Motors · Miami, FL',plannedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),acceptedAt:null,completedAt:null};
const base={session:{user:{id:'driver',phone:'15551234567'}},booting:false,number:'+15551234567',setNumber:noop,otp:'',setOtp:noop,codeSent:false,nextSmsAt:0,sendCode:asyncNoop,verifyCode:asyncNoop,changeNumber:noop,loads:[fixture],visible:[fixture],loadsLoaded:true,loadError:'',busy:false,refreshing:false,refresh:asyncNoop,message:'',dismissMessage:noop,screen:'loads',setScreen:noop,now:Date.now(),invite:fixture.id,health:{enabled:false,queued:0,lastUpload:null,lastCapture:null,error:null},access:{services:true,foreground:true,background:false,precise:true},permissionForLoad:true,openProfileSettings:asyncNoop,permissionOpen:false,permissionStep:'intro',beginStart:asyncNoop,enableLocation:asyncNoop,openSettings:asyncNoop,closePermission:noop,showPermissions:noop,act:asyncNoop,stopAll:asyncNoop,openDocument:asyncNoop,refreshPickupLocation:asyncNoop};
const active={...fixture,status:'active'},past={...fixture,status:'completed'};
const doc={id:'fixture-document',name:'Gate pass.pdf',kind:'gate_pass',mimeType:'application/pdf',size:1000,openedAt:null};
const docLoad={...active,pickupDocuments:{documents:[doc],status:'locked',canOpen:false,unlockedAt:null,unlockMethod:null}};
const availableDoc={...docLoad,pickupDocuments:{...docLoad.pickupDocuments,status:'available',canOpen:true,unlockedAt:new Date().toISOString(),unlockMethod:'arrival'}};
const scenes={documentsLocked:{...base,loads:[docLoad],visible:[docLoad]},documentsReady:{...base,loads:[availableDoc],visible:[availableDoc]},invitation:base,active:{...base,loads:[active],visible:[active],access:{...base.access,background:true},health:{...base.health,enabled:true,lastUpload:new Date().toISOString(),lastCapture:new Date().toISOString()}},profile:{...base,screen:'profile'},permission:{...base,permissionOpen:true},settings:{...base,permissionOpen:true,permissionStep:'settings'},login:{...base,session:null},sms:{...base,session:null,codeSent:true},history:{...base,screen:'history',loads:[past],visible:[past]}};
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{
  const page=await browser.newPage();await page.setViewportSize({width:390,height:844});
  for(const width of [320,390,430]){
   await page.setViewportSize({width,height:width===320?700:844});
   for(const [name,driver] of Object.entries(scenes)){
    RN.AppRegistry.registerComponent('DriverPreview',()=>()=>React.createElement(DriverScreen,{driver}));
    const {element,getStyleElement}=RN.AppRegistry.getApplication('DriverPreview');
    const body=ReactDOM.renderToStaticMarkup(element),styles=ReactDOM.renderToStaticMarkup(getStyleElement());
    const html='<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">'+styles+'<style>html,body{margin:0;height:100%;overflow:hidden}#root{display:flex;height:100dvh}#root>div{flex:1;display:flex}.statusbar{position:absolute;top:13px;left:24px;right:24px;display:flex;justify-content:space-between;font:600 12px -apple-system,BlinkMacSystemFont,sans-serif;color:#202c3d;z-index:3}</style><div class="statusbar"><span>9:41</span><span>••• ▰</span></div><div id="root">'+body+'</div>';
    await page.setContent(html);await page.waitForTimeout(50);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),width+'px '+name+': horizontal overflow');
    if(['invitation','active','login','sms'].includes(name)){
      const button=page.locator('[data-testid^="load-primary-"],[data-testid="login-submit"]').first();
      const bounds=await button.boundingBox();assert.ok(bounds.y+bounds.height<=(width===320?700:844),width+'px '+name+': primary action outside screen');
    }
    if(['permission','settings'].includes(name)){const button=page.locator('[data-testid="permission-continue"]');const bounds=await button.boundingBox();assert.ok(bounds.y>=0 && bounds.y+bounds.height<=(width===320?700:844),width+'px '+name+': permission action outside screen');}
    if(name.startsWith('documents')){const file=page.locator('[data-testid=pickup-document-fixture-document]');assert.equal(await file.isEnabled(),name==='documentsReady');}
    if(width===390)await page.screenshot({path:'/private/tmp/deeptruck-driver-'+name+'.png'});
   }
   console.log('PASS '+width+'px: native screen layout, main actions and location guidance');
  }
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
