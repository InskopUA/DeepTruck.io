import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Linking as NativeLinking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './src/auth';
import { getLoads, loadAction, pauseAll, ApiError } from './src/api';
import { captureNow, flushQueue, requestLocationPermissions, stopCollecting, syncTracking, trackingHealth } from './src/tracking';
import type { Load, LoadStatus } from './src/types';

const labels:Record<LoadStatus,string>={pending:'Invitation',accepted:'Ready to start',active:'Sharing location',paused:'Paused',completed:'Completed',cancelled:'Cancelled',declined:'Declined',expired:'Expired'};
const closed=(status:LoadStatus)=>['completed','cancelled','declined','expired'].includes(status);
const date=(value:string)=>new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
function normalizePhone(value:string) {
  let number=value.replace(/[\s().-]/g,'');
  if(/^\d{10}$/.test(number)) number='+1'+number;
  if(/^1\d{10}$/.test(number)) number='+'+number;
  if(!/^\+[1-9]\d{7,14}$/.test(number)) throw new Error('Enter your phone number with country code, such as +1 555 123 4567.');
  return number;
}
function ask(title:string,message:string,button:string):Promise<boolean> {
  return new Promise(resolve=>Alert.alert(title,message,[{text:'Cancel',style:'cancel',onPress:()=>resolve(false)},{text:button,onPress:()=>resolve(true)}],{cancelable:true,onDismiss:()=>resolve(false)}));
}
function Button({title,onPress,disabled=false,secondary=false,danger=false}:{title:string;onPress:()=>void;disabled?:boolean;secondary?:boolean;danger?:boolean}) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({pressed})=>[s.button,secondary&&s.secondary,danger&&s.danger,(disabled||pressed)&&s.dim]}><Text style={[s.buttonText,secondary&&s.secondaryText,danger&&s.dangerText]}>{title}</Text></Pressable>;
}

export default function App() {
  const [session,setSession]=useState<Session|null>(null),[booting,setBooting]=useState(true);
  const [number,setNumber]=useState(''),[otp,setOtp]=useState(''),[codeSent,setCodeSent]=useState(false),[nextSmsAt,setNextSmsAt]=useState(0),[now,setNow]=useState(Date.now());
  const [loads,setLoads]=useState<Load[]>([]),[busy,setBusy]=useState(false),[refreshing,setRefreshing]=useState(false),[message,setMessage]=useState(''),[tab,setTab]=useState<'open'|'history'>('open');
  const [loadsLoaded,setLoadsLoaded]=useState(false),[loadError,setLoadError]=useState('');
  const [health,setHealth]=useState<{enabled:boolean;queued:number;lastUpload:string|null;error:string|null}>({enabled:false,queued:0,lastUpload:null,error:null});
  const [invite,setInvite]=useState('');
  const refreshingRef=useRef(false),userRef=useRef(''),revisionRef=useRef(0),busyRef=useRef(false);
  const link=Linking.useURL();
  useEffect(()=>{if(!link)return;try{const query=Linking.parse(link).queryParams;const id=query?.invite;if(typeof id==='string'&&/^[0-9a-f-]{36}$/i.test(id)){setInvite(id);setTab('open');}}catch{}},[link]);
  useEffect(()=>{
    let mounted=true;
    supabase.auth.getSession().then(({data,error})=>{if(mounted){setSession(data.session);if(error)setMessage(error.message);setBooting(false);}});
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,value)=>{
      setSession(value);userRef.current=value?.user.id || '';
      if(!value){setLoads([]);void stopCollecting(true).catch(()=>{});}
    });
    const subscriptionState=AppState.addEventListener('change',state=>{if(state==='active')supabase.auth.startAutoRefresh();else supabase.auth.stopAutoRefresh();});
    if(AppState.currentState==='active')supabase.auth.startAutoRefresh();
    const clock=setInterval(()=>setNow(Date.now()),1000);
    return()=>{mounted=false;subscription.unsubscribe();subscriptionState.remove();clearInterval(clock);supabase.auth.stopAutoRefresh();};
  },[]);
  const refresh=useCallback(async()=>{
    if(refreshingRef.current || busyRef.current || !userRef.current)return;
    refreshingRef.current=true;setRefreshing(true);const userId=userRef.current,revision=revisionRef.current;
    let receivedLoads=false;
    try {
      const data=await getLoads();if(userRef.current!==userId || revision!==revisionRef.current)return;
      setLoads(data.items);
      setLoadsLoaded(true);setLoadError('');receivedLoads=true;
      await syncTracking(data.items);
      await flushQueue();setHealth(await trackingHealth());
    } catch(e) {
      if(userRef.current!==userId || revision!==revisionRef.current)return;
      if(e instanceof ApiError && e.status===401) {
        await stopCollecting(true);
        await supabase.auth.signOut({scope:'local'});
        setMessage('Your session expired. Sign in with your phone number again.');
      } else if(receivedLoads) setMessage(e instanceof Error?e.message:'Could not sync location sharing.');
      else setLoadError(e instanceof Error?e.message:'Could not refresh your loads.');
    }
    finally{refreshingRef.current=false;setRefreshing(false);}
  },[session?.user.id]);
  useEffect(()=>{
    userRef.current=session?.user.id || '';
    setLoads([]);setLoadsLoaded(false);setLoadError('');
    if(!session)return;
    void refresh();
    const timer=setInterval(()=>{if(AppState.currentState==='active')void refresh();},15000);
    const resume=AppState.addEventListener('change',state=>{if(state==='active')void refresh();});
    return()=>{clearInterval(timer);resume.remove();};
  },[session?.user.id,refresh]);
  const run=async(fn:()=>Promise<void>)=>{if(busyRef.current)return;busyRef.current=true;revisionRef.current++;setBusy(true);setMessage('');try{await fn();}catch(e){setMessage(e instanceof Error?e.message:'Please try again.');}finally{busyRef.current=false;setBusy(false);}};
  async function sendCode() {
    await run(async()=>{
      if(Date.now()<nextSmsAt)throw new Error('Please wait before requesting another code.');
      const phone=normalizePhone(number);setNumber(phone);
      const {error}=await supabase.auth.signInWithOtp({phone});if(error)throw error;
      setCodeSent(true);setNextSmsAt(Date.now()+60000);setMessage('Enter the code sent to '+phone+'.');
    });
  }
  async function verifyCode() {
    await run(async()=>{
      if(!/^\d{6}$/.test(otp))throw new Error('Enter the six-digit SMS code.');
      const {error}=await supabase.auth.verifyOtp({phone:normalizePhone(number),token:otp,type:'sms'});if(error)throw error;
      setOtp('');setCodeSent(false);setMessage('');
    });
    // The sign-in event can fire while run() is still busy and skip its first refresh.
    if(userRef.current)void refresh();
  }
  async function act(load:Load,action:'accept'|'decline'|'start'|'pause'|'complete') {
    if(action==='accept'&&!await ask('Accept this load?',`${load.dealerName} requests tracking for “${load.title}” until ${date(load.expiresAt)}. Location is shared only after you tap Start sharing. History recorded while sharing stays with this load. You can pause at any time.`,'Accept load'))return;
    if(action==='decline'&&!await ask('Decline invitation?',`Decline “${load.title}” from ${load.dealerName}?`,'Decline'))return;
    if(action==='complete'&&!await ask('Complete this load?',`Close location access for “${load.title}”. Your other active loads will continue.`,'Complete'))return;
    if(action==='start'&&!await ask('Start sharing location?',`Share your phone location with ${load.dealerName} for this load, including while the screen is locked. On the next screen, allow background location. You can stop sharing at any time.`,'Continue'))return;
    await run(async()=>{
      if(action==='start')await requestLocationPermissions();
      if(action==='pause'&&loads.filter(v=>v.status==='active').length===1)await stopCollecting(true);
      await loadAction(load.id,action);
      const data=await getLoads();setLoads(data.items);
      try {await syncTracking(data.items,action==='start');}
      catch(e){if(action==='start')await pauseAll().catch(()=>{});throw e;}
      if(action==='start')await captureNow().catch(()=>{setMessage('Sharing is enabled. Waiting for a location fix.');});
      await flushQueue();setHealth(await trackingHealth());
      if(action==='accept')setMessage('Load accepted. Tap Start sharing when you begin the trip.');
    });
  }
  async function stopAll(signOut=false) {
    if(!await ask(signOut?'Sign out?':'Stop all sharing?',signOut?'Sharing for all your loads will stop before you sign out.':'Stop collecting location on this phone and pause all your active loads.','Stop sharing'))return;
    await run(async()=>{
      await stopCollecting(true);setHealth(await trackingHealth());
      try {await pauseAll();}catch(e) {
        if(signOut && e instanceof ApiError && e.status===401) {await supabase.auth.signOut({scope:'local'});return;}
        throw new Error('Location collection stopped on this phone. Connect to the internet to close access for your loads'+(signOut?' and sign out.':'.'));
      }
      if(signOut){const {error}=await supabase.auth.signOut();if(error)throw error;}
      else{const data=await getLoads();setLoads(data.items);setMessage('Location sharing is paused for all loads.');}
    });
  }
  const effective=loads.map(v=>!closed(v.status)&&Date.parse(v.expiresAt)<=now?{...v,status:'expired' as const}:v);
  const active=effective.filter(v=>v.status==='active'),pending=effective.filter(v=>v.status==='pending');
  const visible=effective.filter(v=>tab==='history'?closed(v.status):!closed(v.status)).sort((a,b)=>a.id===invite?-1:b.id===invite?1:0);
  if(booting)return <SafeAreaProvider><SafeAreaView style={s.screen}><ActivityIndicator size="large" color="#286bc0"/></SafeAreaView></SafeAreaProvider>;
  return <SafeAreaProvider><SafeAreaView style={s.screen}>
    <View style={s.brandRow}><Text style={s.brand}>DeepTruck <Text style={s.brandSmall}>Driver</Text></Text>{session&&<Pressable accessibilityRole="button" onPress={()=>void stopAll(true)} disabled={busy}><Text style={s.link}>Sign out</Text></Pressable>}</View>
    {!session ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.login}>
      <View style={s.heroIcon}><Text style={s.heroGlyph}>↗</Text></View><Text style={s.heading}>Your loads.{ '\n' }One place.</Text><Text style={s.subtitle}>Share delivery progress with the dealers you choose.</Text>
      <View style={s.card}><Text style={s.cardTitle}>{codeSent?'Check your messages':'Sign in with your phone'}</Text><Text style={s.body}>{codeSent?'Enter the six-digit code sent to '+number:'Use the phone number that received your load invitation.'}</Text>
        {!codeSent?<><Text style={s.label}>Phone number</Text><TextInput accessibilityLabel="Phone number" style={s.input} value={number} onChangeText={setNumber} keyboardType="phone-pad" textContentType="telephoneNumber" placeholder="+1 (555) 123-4567" editable={!busy}/><Button title={busy?'Sending…':'Send SMS code'} disabled={busy||!number.trim()||now<nextSmsAt} onPress={()=>void sendCode()}/></>:<><Text style={s.label}>SMS code</Text><TextInput accessibilityLabel="SMS code" style={s.input} value={otp} onChangeText={v=>setOtp(v.replace(/\D/g,''))} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="sms-otp" maxLength={6} editable={!busy}/><Button title={busy?'Checking…':'Continue'} disabled={busy||otp.length!==6} onPress={()=>void verifyCode()}/><Button title={now<nextSmsAt?`Resend in ${Math.ceil((nextSmsAt-now)/1000)}s`:'Resend code'} secondary disabled={busy||now<nextSmsAt} onPress={()=>void sendCode()}/><Pressable accessibilityRole="button" onPress={()=>{setCodeSent(false);setOtp('');setMessage('');}} disabled={busy}><Text style={s.link}>Change phone number</Text></Pressable></>}
      </View>{message?<Text accessibilityLiveRegion="polite" style={s.message}>{message}</Text>:null}<Text style={s.footer}>Location is shared only for loads you accept and start.</Text>
    </ScrollView> : <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>void refresh()} tintColor="#286bc0"/>}>
      <Text style={s.heading}>Your loads</Text><Text style={s.subtitle}>{pending.length?`${pending.length} invitation${pending.length===1?'':'s'} to review`:'Delivery progress, on your terms.'}</Text>
      <View style={[s.sharingBanner,health.enabled&&active.length>0&&s.sharingOn]}><Text style={s.cardTitle}>{health.enabled&&active.length>0?`Sharing for ${active.length} load${active.length===1?'':'s'}`:'Location sharing is off'}</Text><Text style={s.body}>{health.error || (health.enabled&&active.length>0?'Your phone sends one location update for all active loads.':'Accept a load and tap Start sharing to begin.')}</Text>{health.queued>0?<Text style={s.body}>{health.queued} location updates waiting to sync.</Text>:null}{health.enabled&&active.length>0?<Button title="Stop all sharing" secondary danger disabled={busy} onPress={()=>void stopAll()}/>:null}</View>
      {message?<Text accessibilityLiveRegion="polite" style={s.message}>{message}</Text>:null}
      {loadError?<Text accessibilityLiveRegion="polite" style={s.message}>{loadError}</Text>:null}
      {message.toLowerCase().includes('settings')?<Button title="Open phone settings" secondary disabled={busy} onPress={()=>void NativeLinking.openSettings()}/>:null}
      <View style={s.tabs}><Pressable accessibilityRole="tab" accessibilityState={{selected:tab==='open'}} onPress={()=>setTab('open')} style={[s.tab,tab==='open'&&s.tabActive]}><Text style={s.tabText}>Active & invitations</Text></Pressable><Pressable accessibilityRole="tab" accessibilityState={{selected:tab==='history'}} onPress={()=>setTab('history')} style={[s.tab,tab==='history'&&s.tabActive]}><Text style={s.tabText}>History</Text></Pressable></View>
      {!visible.length?<View style={s.card}><Text style={s.cardTitle}>{!loadsLoaded ? loadError?'Unable to load invitations':'Loading your loads…' : tab==='history'?'No completed loads yet':'No loads yet'}</Text>{!loadsLoaded ? loadError?<Button title="Try again" secondary disabled={refreshing||busy} onPress={()=>void refresh()}/>:<ActivityIndicator color="#286bc0"/>:<Text style={s.body}>{tab==='history'?'Closed loads appear here.':'Invitations sent to your verified phone number will appear here. Pull down to refresh.'}</Text>}</View>:visible.map(load=><View key={load.id} style={[s.card,load.id===invite&&s.invitedCard]}>
        <View style={s.cardHeading}><Text style={s.dealer}>{load.dealerName}</Text><View style={[s.badge,load.status==='active'&&s.badgeActive]}><Text style={s.badgeText}>{labels[load.status]}</Text></View></View><Text style={s.loadTitle}>{load.title}</Text><Text style={s.body}>{load.carrierName} · USDOT {load.carrierDot}</Text>
        {load.pickupAddress?<View style={s.address}><Text style={s.label}>PICKUP</Text><Text style={s.body}>{load.pickupAddress}</Text></View>:null}{load.deliveryAddress?<View style={s.address}><Text style={s.label}>DELIVERY</Text><Text style={s.body}>{load.deliveryAddress}</Text></View>:null}
        {load.vehicles.length?<View style={s.address}><Text style={s.label}>VEHICLES</Text>{load.vehicles.map((v,i)=><Text key={i} style={s.body}>{v}</Text>)}</View>:null}
        {load.plannedAt?<Text style={s.meta}>Planned pickup: {date(load.plannedAt)}</Text>:null}<Text style={s.meta}>Access expires: {date(load.expiresAt)}</Text>
        {load.status==='pending'?<><Button title="Accept load" disabled={busy} onPress={()=>void act(load,'accept')}/><Button title="Decline" secondary disabled={busy} onPress={()=>void act(load,'decline')}/></>:null}
        {['accepted','paused'].includes(load.status)||load.status==='active'&&!health.enabled?<Button title={load.status==='accepted'?'Start sharing':'Resume sharing'} disabled={busy} onPress={()=>void act(load,'start')}/>:null}
        {load.status==='active'&&health.enabled?<Button title="Pause this load" secondary disabled={busy} onPress={()=>void act(load,'pause')}/>:null}
        {['accepted','active','paused'].includes(load.status)?<Button title="Complete load" secondary disabled={busy} onPress={()=>void act(load,'complete')}/>:null}
      </View>)}
      <Pressable accessibilityRole="link" onPress={()=>void NativeLinking.openURL('https://www.deeptruck.io/privacy')}><Text style={[s.footer,s.link]}>Privacy policy</Text></Pressable>
    </ScrollView>}
  </SafeAreaView></SafeAreaProvider>;
}
const s=StyleSheet.create({
  screen:{flex:1,backgroundColor:'#f5f7fa'},brandRow:{paddingHorizontal:22,paddingVertical:18,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},brand:{fontSize:21,fontWeight:'700',color:'#1c293b',letterSpacing:-.6},brandSmall:{fontSize:15,fontWeight:'400',color:'#657387'},link:{color:'#286bc0',fontSize:13,fontWeight:'600'},login:{padding:22,paddingTop:28,gap:18},content:{padding:20,paddingTop:10,gap:16,paddingBottom:40},heading:{fontSize:32,fontWeight:'700',color:'#1c293b',letterSpacing:-1,lineHeight:38},subtitle:{fontSize:15,lineHeight:23,color:'#657387'},heroIcon:{backgroundColor:'#e8f1ff',height:64,width:64,borderRadius:18,justifyContent:'center',alignItems:'center'},heroGlyph:{fontSize:32,color:'#286bc0'},card:{backgroundColor:'#fff',borderColor:'#e6ebf1',borderWidth:1,borderRadius:16,padding:20,gap:12},cardTitle:{fontSize:17,fontWeight:'600',color:'#1c293b'},body:{color:'#657387',fontSize:13,lineHeight:20},label:{fontSize:12,color:'#657387',fontWeight:'600'},input:{backgroundColor:'#fff',borderWidth:1,borderColor:'#d8e0e9',borderRadius:9,paddingHorizontal:14,minHeight:50,fontSize:17,color:'#1c293b'},button:{backgroundColor:'#286bc0',borderRadius:9,minHeight:46,paddingHorizontal:16,paddingVertical:12,justifyContent:'center',alignItems:'center'},buttonText:{fontSize:14,fontWeight:'600',color:'#fff'},secondary:{backgroundColor:'#f5f8fc',borderWidth:1,borderColor:'#dfe7f0'},secondaryText:{color:'#286bc0'},danger:{backgroundColor:'#fff5f4',borderColor:'#f3ddda'},dangerText:{color:'#a33e36'},dim:{opacity:.55},message:{backgroundColor:'#fff4df',borderRadius:9,padding:14,color:'#755a25',fontSize:13,lineHeight:20},footer:{fontSize:12,lineHeight:19,color:'#7c899b',textAlign:'center',paddingTop:8},sharingBanner:{backgroundColor:'#edf2f8',borderRadius:13,padding:18,gap:10},sharingOn:{backgroundColor:'#edf8f2'},tabs:{flexDirection:'row',padding:4,backgroundColor:'#eaf0f6',borderRadius:10},tab:{flex:1,alignItems:'center',padding:11,borderRadius:7},tabActive:{backgroundColor:'#fff'},tabText:{fontSize:12,fontWeight:'600',color:'#53677e'},cardHeading:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',justifyContent:'space-between',gap:8},dealer:{fontSize:12,fontWeight:'600',color:'#53677e',flexShrink:1},badge:{backgroundColor:'#f1f4f8',borderRadius:6,paddingHorizontal:8,paddingVertical:5},badgeActive:{backgroundColor:'#e0f0e8'},badgeText:{fontSize:10,color:'#53677e',fontWeight:'600'},loadTitle:{fontSize:20,fontWeight:'600',color:'#1c293b',letterSpacing:-.4},address:{gap:5,paddingTop:4},meta:{fontSize:11,lineHeight:17,color:'#7c899b'},invitedCard:{borderColor:'#81ade0',borderWidth:2}
});
