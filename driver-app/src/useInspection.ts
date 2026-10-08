import {useEffect,useRef,useState} from 'react';
import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import {Linking} from 'react-native';
import {api} from './api';
import type {DamageRecord} from '../../supabase/functions/_shared/damage-codes';
import {loadInspectionDraft,saveInspectionDraft,retainInspectionPhoto,type InspectionDraft,type LocalPhoto} from './inspection-store';
import type {PickupInspection} from './types';

export function useInspection(actor:string,load:string,document:string,onFinished:()=>void){
  const [draft,setDraft]=useState<InspectionDraft|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[syncing,setSyncing]=useState(false),[message,setMessage]=useState('');
  const current=useRef<InspectionDraft|null>(null),alive=useRef(true),syncPromise=useRef<Promise<void>|null>(null),base=`/driver/loads/${load}/documents/${document}/inspection`;
  async function put(next:InspectionDraft){current.current=next;if(alive.current)setDraft(next);await saveInspectionDraft(actor,document,next);}
  function fromServer(server:PickupInspection,local:InspectionDraft|null):InspectionDraft{
    return {id:server.id,status:server.status,damages:server.damages,photos:server.photos.map(p=>{const cached=local?.photos.find(v=>v.id===p.id);return {...p,uri:cached?.uri || '',uploaded:true};}),revision:server.revision,sequence:local?.sequence || 0,syncedSequence:local?.sequence || 0,shareUrl:server.shareUrl,completedAt:server.completedAt};
  }
  useEffect(()=>{alive.current=true;void(async()=>{
    let cached:InspectionDraft|null=null;
    try{
      cached=await loadInspectionDraft(actor,document);
      const data=await api<{inspection:PickupInspection|null}>(base);
      if(!alive.current)return;
      if(data.inspection){
        const merged=fromServer(data.inspection,cached);
        if(cached && cached.id===merged.id && cached.sequence>cached.syncedSequence && merged.status==='draft'){
          if(cached.revision!==merged.revision && JSON.stringify(cached.damages)!==JSON.stringify(merged.damages) && JSON.stringify(cached.lastSubmittedDamages)!==JSON.stringify(merged.damages))throw new Error('Inspection changed on another device. Reopen it to load the saved version.');
          await put({...cached,revision:merged.revision,photos:cached.photos.map(p=>{const remote=merged.photos.find(v=>v.id===p.id);return {...p,uploaded:Boolean(remote)||p.uploaded,url:remote?.url||p.url};})});
        }else await put(merged);
      }else if(cached && cached.status==='draft'){await put(cached);}else {await start();}
    }catch(error){if(!alive.current)return;if(error instanceof Error && error.message.includes('another device')){const latest=await api<{inspection:PickupInspection}>(base);await put({...fromServer(latest.inspection,cached),sequence:(cached?.sequence||0)+1,syncedSequence:(cached?.sequence||0)+1});setMessage('Loaded the latest saved inspection. Review your notes.');}else if(cached && cached.status==='draft'){await put(cached);setMessage('Saved on this phone. Reconnect to sync your inspection.');}else setMessage(error instanceof Error?error.message:'Unable to open inspection.');}
    finally{if(alive.current)setLoading(false);}
  })();return()=>{alive.current=false;};},[actor,load,document]);
  async function sync(){
    if(syncPromise.current)return syncPromise.current;
    const promise=(async()=>{
      if(alive.current)setSyncing(true);
      try{
        while(current.current && current.current.status==='draft' && (current.current.sequence>current.current.syncedSequence || current.current.photos.some(p=>!p.uploaded))){
          let snapshot=current.current;
          // Recover a successful write whose response was lost, without overwriting
          // a different edit from another device. Photo IDs are idempotent as well.
          const remote=await api<{inspection:PickupInspection|null}>(base);
          if(remote.inspection){
            const r=remote.inspection;
            if(r.id!==snapshot.id)throw new Error('Another inspection exists. Reopen this gate pass.');
            if(r.status==='completed'){await put(fromServer(r,snapshot));break;}
            if(r.revision!==snapshot.revision){
              if(JSON.stringify(r.damages)!==JSON.stringify(snapshot.damages) && JSON.stringify(r.damages)!==JSON.stringify(snapshot.lastSubmittedDamages))throw new Error('Inspection changed on another device. Reopen it before continuing.');
              await put({...current.current!,revision:r.revision,photos:current.current!.photos.map(p=>{const uploaded=r.photos.find(v=>v.id===p.id);return {...p,uploaded:!!uploaded||p.uploaded,url:uploaded?.url||p.url};})});snapshot={...snapshot,revision:r.revision,photos:current.current!.photos};
            }
          }
          await put({...current.current!,lastSubmittedDamages:snapshot.damages});
          const saved=await api<{inspection:PickupInspection}>(base,{id:snapshot.id,revision:snapshot.revision,damages:snapshot.damages});
          if(!current.current || saved.inspection.id!==current.current.id)throw new Error('Inspection changed. Reload it.');
          await put({...current.current,revision:saved.inspection.revision});
          for(const photo of snapshot.photos.filter(p=>!p.uploaded && snapshot.damages.some(d=>d.id===p.damageId))){
            const form=new FormData();form.append('id',photo.id);form.append('damageId',photo.damageId);form.append('file',{uri:photo.uri,name:photo.id+(photo.mimeType==='image/png'?'.png':'.jpg'),type:photo.mimeType} as unknown as Blob);
            const uploaded=await api<{inspection:PickupInspection}>(base+'/photos',form);
            const remote=uploaded.inspection.photos.find(p=>p.id===photo.id);
            await put({...current.current!,revision:uploaded.inspection.revision,photos:current.current!.photos.map(p=>p.id===photo.id?{...p,uploaded:true,url:remote?.url}:p)});
          }
          await put({...current.current!,syncedSequence:snapshot.sequence});
        }
        if(alive.current)setMessage('');
      }finally{if(alive.current)setSyncing(false);}
    })();syncPromise.current=promise;
    try{await promise;}finally{if(syncPromise.current===promise)syncPromise.current=null;}
  }
  function backgroundSync(){void sync().catch(error=>{if(alive.current)setMessage(error instanceof Error?error.message:'Saved on this phone. Reconnect to sync your inspection.');});}
  async function start(){
    setBusy(true);setMessage('');
    try{
      const existing=await api<{inspection:PickupInspection|null}>(base);
      const server=existing.inspection || (await api<{inspection:PickupInspection}>(base,{id:Crypto.randomUUID(),damages:[],revision:0})).inspection;
      await put({...fromServer(server,null),sequence:1,syncedSequence:1});
    }catch(error){setMessage(error instanceof Error?error.message:'Unable to start inspection.');}finally{setBusy(false);}
  }
  async function saveDamage(damage:DamageRecord){const value=current.current;if(!value || value.status!=='draft')return;await put({...value,sequence:value.sequence+1,damages:[...value.damages.filter(d=>d.id!==damage.id),damage]});backgroundSync();}
  async function removeDamage(id:string){const value=current.current;if(!value || value.status!=='draft')return;await put({...value,sequence:value.sequence+1,damages:value.damages.filter(d=>d.id!==id),photos:value.photos.filter(p=>p.damageId!==id)});backgroundSync();}
  async function addPhoto(damageId:string,camera:boolean){
    if(busy)return;const value=current.current;if(!value || value.status!=='draft')return;
    if(value.photos.filter(p=>p.damageId===damageId).length>=3){setMessage('Add no more than 3 photos per damage.');return;}
    setBusy(true);setMessage('');
    try{
      if(camera){const permission=await ImagePicker.requestCameraPermissionsAsync();if(!permission.granted)throw new Error('Allow camera access in Settings to take a damage photo.');}
      const options:ImagePicker.ImagePickerOptions={mediaTypes:['images'],quality:.6,preferredAssetRepresentationMode:ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible};
      const result=camera?await ImagePicker.launchCameraAsync(options):await ImagePicker.launchImageLibraryAsync(options);
      if(result.canceled)return;const asset=result.assets[0];if(asset.fileSize && asset.fileSize>10485760)throw new Error('Choose a photo smaller than 10 MB.');
      const mime=asset.mimeType || 'image/jpeg';if(!['image/jpeg','image/png'].includes(mime))throw new Error('Choose a JPG or PNG photo.');
      const id=Crypto.randomUUID(),photo:LocalPhoto={id,damageId,uri:retainInspectionPhoto(actor,document,id,asset.uri,mime),mimeType:mime,uploaded:false};
      const now=current.current!;if(!now.damages.some(d=>d.id===damageId))return;await put({...now,sequence:now.sequence+1,photos:[...now.photos,photo]});backgroundSync();
    }catch(error){setMessage(error instanceof Error?error.message:'Unable to add photo.');}finally{setBusy(false);}
  }
  async function publish(finish:boolean,noDamageObserved:boolean){
    if(busy)return;setBusy(true);setMessage('');
    try{
      await sync();const value=current.current;if(!value)throw new Error('Start an inspection first.');
      const missing=value.damages.find(d=>!value.photos.some(p=>p.damageId===d.id && p.uploaded));if(missing)throw new Error('Add a photo for each recorded damage.');
      if(!value.damages.length && !noDamageObserved)throw new Error('Select No visible damage observed to finish without damage notes.');
      const response=await api<{inspection:PickupInspection;url:string}>(base+(finish?'/finish':'/preview'),{revision:value.revision,noDamageObserved});
      await put({...fromServer(response.inspection,value),sequence:value.sequence,syncedSequence:value.sequence});
      if(finish)onFinished();else await Linking.openURL(response.url);
    }catch(error){setMessage(error instanceof Error?error.message:'Unable to generate gate pass.');}finally{setBusy(false);}
  }
  async function openPhoto(id:string){try{const {inspection}=await api<{inspection:PickupInspection}>(base);const photo=inspection.photos.find(p=>p.id===id);if(photo)await Linking.openURL(photo.url);}catch(error){setMessage(error instanceof Error?error.message:'Unable to open photo.');}}
  async function openPdf(){setBusy(true);try{const {url}=await api<{url:string}>(base+'/open',{});await Linking.openURL(url);}catch(error){setMessage(error instanceof Error?error.message:'Unable to open gate pass.');}finally{setBusy(false);}}
  return {draft,loading,busy,syncing,message,start,saveDamage,removeDamage,addPhoto,publish,openPdf,openPhoto,sync};
}
