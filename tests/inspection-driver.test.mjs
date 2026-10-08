import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
const require=createRequire(import.meta.url),{app,loadDriver}=require('./driver-module.cjs'),React=require(app+'/node_modules/react'),renderer=require(app+'/node_modules/react-test-renderer'),{act}=renderer;
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
test('Driver inspection persists offline notes, recovers lost writes/photos, uses the selected gate pass and finishes once',async()=>{
  let current,tree,cache=null,server=null,online=true,lostWrite=false,lostPhoto=false,finished=0,pickerCalls=0;
  const copy=v=>JSON.parse(JSON.stringify(v));
  const api=async(path,body)=>{
    if(!online)throw new Error('Network unavailable');
    if(body===undefined)return {inspection:server?copy(server):null};
    if(path.endsWith('/photos')){
      const id=body.get('id'),damageId=body.get('damageId');
      if(!server.photos.some(p=>p.id===id)){server.photos.push({id,damageId,url:'https://fixture/photo',mimeType:'image/jpeg',size:100});server.revision++;}
      if(lostPhoto){lostPhoto=false;throw new Error('Response lost');}return {inspection:copy(server)};
    }
    if(path.endsWith('/finish')||path.endsWith('/preview')){assert.equal(body.revision,server.revision);assert.ok(server.photos.length);if(path.endsWith('/finish'))server.status='completed';return {inspection:copy(server),url:'https://fixture/pdf'};}
    if(!server){server={...body,revision:1,status:'draft',photos:[],shareUrl:null,completedAt:null};}
    else{assert.equal(body.revision,server.revision,'never overwrite stale version');server.damages=copy(body.damages);server.revision++;}
    if(lostWrite){lostWrite=false;throw new Error('Response lost');}return {inspection:copy(server)};
  };
  const store={loadInspectionDraft:async()=>cache?copy(cache):null,saveInspectionDraft:async(a,d,next)=>{cache=copy(next);},retainInspectionPhoto:()=> 'file:///private/photo.jpg'};
  const picker={requestCameraPermissionsAsync:async()=>({granted:true}),UIImagePickerPreferredAssetRepresentationMode:{Compatible:'compatible'},launchCameraAsync:async()=>{pickerCalls++;return {canceled:false,assets:[{uri:'file:///tmp/picked.jpg',fileSize:100,mimeType:'image/jpeg'}]};}};
  const {useInspection}=loadDriver('src/useInspection.ts',{'./api':{api},'./inspection-store':store,'expo-crypto':{randomUUID},'expo-image-picker':picker,'react-native':{Linking:{openURL:async()=>{}}}});
  function Probe(){current=useInspection('actor','load','document',()=>{finished++;});return React.createElement('probe');}
  const settle=async()=>act(async()=>{await new Promise(r=>setTimeout(r,20));});
  await act(async()=>{tree=renderer.create(React.createElement(Probe));});await settle();
  try{
    assert.ok(current.draft,'inspection starts immediately without VIN');assert.equal(current.draft.vin,undefined);assert.equal(current.draft.revision,1);
    const d={id:randomUUID(),areaId:'left-front-door',typeId:'scratch',severity:3,code:'10-12-3',areaLabel:'Left front door',typeLabel:'Scratch',sizeLabel:'Over 3–6 in'};
    online=false;await act(async()=>current.saveDamage(d));await settle();assert.equal(cache.damages.length,1);assert.ok(cache.sequence>cache.syncedSequence);
    await act(async()=>tree.unmount());await act(async()=>{tree=renderer.create(React.createElement(Probe));});await settle();assert.equal(current.draft.damages.length,1,'offline draft survives screen restart');
    online=true;lostWrite=true;await act(async()=>{await assert.rejects(()=>current.sync(),/Response lost/);});assert.equal(server.damages.length,1);await act(async()=>current.sync());assert.equal(current.draft.syncedSequence,current.draft.sequence,'lost save response safely recovered');
    lostPhoto=true;await act(async()=>current.addPhoto(d.id,true));await settle();assert.equal(pickerCalls,1);assert.equal(cache.photos[0].uri,'file:///private/photo.jpg');assert.equal(server.photos.length,1);assert.equal(cache.photos[0].uploaded,false);
    await act(async()=>current.sync());assert.equal(server.photos.length,1,'lost upload response does not duplicate photo');assert.equal(current.draft.photos[0].uploaded,true);
    await act(async()=>current.publish(true,false));assert.equal(current.draft.status,'completed');assert.equal(finished,1);assert.equal(cache.status,'completed');
  }finally{await act(async()=>tree.unmount());}
});
