const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{chromium}=require('playwright'),{app,loadDriver}=require('./driver-module.cjs');
const React=require(app+'/node_modules/react'),ReactDOM=require(app+'/node_modules/react-dom/server'),RN=require(app+'/node_modules/react-native-web');
const noop=()=>{},svg={__esModule:true,default:props=>React.createElement('svg',{...props,xmlns:'http://www.w3.org/2000/svg'},props.children)};for(const tag of ['Path','Rect','Circle','G'])svg[tag]=({onPress,accessible,accessibilityLabel,...props})=>React.createElement(tag.toLowerCase(),props);
const doc={id:'doc',name:'Vehicle gate pass.pdf',kind:'gate_pass'},load={id:'load'},damage={id:'damage',areaId:'left-front-door',typeId:'scratch',severity:3,code:'10-12-3',areaLabel:'Left front door',typeLabel:'Scratch',sizeLabel:'Over 3–6 in'};
let stateValues=[],inspection;
const mocks={'react':{...React,useState:init=>[stateValues.length?stateValues.shift():init,noop]},'react-native':{...RN,Modal:({children})=>React.createElement(RN.View,{style:{flex:1}},children)},'react-native-safe-area-context':{SafeAreaView:({children,style})=>React.createElement(RN.View,{style:[style,{paddingTop:44,paddingBottom:20}]},children)},'expo-crypto':{randomUUID:()=> 'id'},'react-native-svg':svg,'./useInspection':{useInspection:()=>inspection}};
const {InspectionScreen}=loadDriver('src/InspectionScreen.tsx',mocks);
const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCfoAAAAASUVORK5CYII=';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{
  const page=await browser.newPage(),draft={id:'inspection',status:'draft',damages:[damage],photos:[{id:'photo',damageId:'damage',uri:photo,uploaded:true}],sequence:1,syncedSequence:1,shareUrl:null};
  for(const width of [320,390,430])for(const scene of ['start','left','right','front','rear','top','edit','review','completed']){
    stateValues=[['right','front','rear','top'].includes(scene)?scene:'left',scene==='edit'?'left-front-door':'',scene==='edit'?'scratch':'',scene==='edit'?3:null,null,scene==='review',false];
    inspection={draft:scene==='start'?null:{...draft,status:scene==='completed'?'completed':'draft'},loading:false,busy:false,syncing:false,message:'',start:noop,saveDamage:noop,removeDamage:noop,addPhoto:noop,publish:noop,openPdf:noop,sync:noop};
    RN.AppRegistry.registerComponent('InspectionPreview',()=>()=>React.createElement(InspectionScreen,{actor:'actor',load,document:doc,close:noop,onFinished:noop}));
    const {element,getStyleElement}=RN.AppRegistry.getApplication('InspectionPreview');
    const html='<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">'+ReactDOM.renderToStaticMarkup(getStyleElement())+'<style>html,body{margin:0;height:100%}#root{display:flex;height:100dvh}#root>div{flex:1;display:flex}svg{flex-shrink:0}</style><div id="root">'+ReactDOM.renderToStaticMarkup(element)+'</div>';
    await page.setViewportSize({width,height:844});await page.setContent(html);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}px ${scene} overflows`);
    if(width===390)await page.screenshot({path:'/private/tmp/deeptruck-inspection-'+scene+'.png'});
  }
  console.log('PASS inspection screens and all five vehicle views at 320/390/430px');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
