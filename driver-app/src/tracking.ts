import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import { supabase } from './auth';
import { sendPoints, ApiError } from './api';
import { canCollect, validPoint, MAX_QUEUED_POINTS } from './tracking-policy';
import type { Load, Point, SharingControl } from './types';

const TASK='deeptruck-driver-location-v1';
const CONTROL='dt.sharing-control';
let dbPromise:Promise<SQLite.SQLiteDatabase>|undefined;
let flushing:Promise<void>|null=null;
let operation:Promise<unknown>=Promise.resolve();
function serial<T>(run:()=>Promise<T>):Promise<T> {const next=operation.then(run,run);operation=next.catch(()=>{});return next;}
async function database() {
  if(!dbPromise) dbPromise=(async()=>{const db=await SQLite.openDatabaseAsync('tracking-queue.db');await db.execAsync('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS queue (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, payload TEXT NOT NULL, captured_at INTEGER NOT NULL);');return db;})();
  return dbPromise;
}
async function control():Promise<SharingControl|null> {try{return JSON.parse(await SecureStore.getItemAsync(CONTROL) || 'null');}catch{return null;}}
async function serverNow() {return Date.now() + Number(await SecureStore.getItemAsync('dt.clock-offset') || '0');}
export async function queueCount() {const db=await database();const row=await db.getFirstAsync<{n:number}>('SELECT count(*) n FROM queue');return row?.n || 0;}
async function clearQueue() {await (await database()).runAsync('DELETE FROM queue');}
async function stopNative(clear:boolean) {
  const state=await control();
  if(state) await SecureStore.setItemAsync(CONTROL,JSON.stringify({...state,enabled:false,loads:[]}));
  if(await Location.hasStartedLocationUpdatesAsync(TASK)) await Location.stopLocationUpdatesAsync(TASK);
  if(clear) await clearQueue();
}
export const stopCollecting = (clear=true) => serial(()=>stopNative(clear));
export async function requestLocationPermissions() {
  if(!await Location.hasServicesEnabledAsync()) throw new Error('Turn on location services in your phone settings.');
  const foreground=await Location.requestForegroundPermissionsAsync();
  if(foreground.status!=='granted') throw new Error('Allow location access to start sharing this load.');
  const background=await Location.requestBackgroundPermissionsAsync();
  if(background.status!=='granted') throw new Error('Allow background location in phone settings so sharing works with the screen locked.');
}
export async function syncTracking(loads:Load[],enable=false) {
  return serial(async()=>{
    const {data:{session}}=await supabase.auth.getSession();
    if(!session) {await stopNative(true);return false;}
    const active=loads.filter(v=>v.status==='active'&&Date.parse(v.expiresAt)>Date.now());
    const previous=await control();
    if(!active.length) {await stopNative(false);return false;}
    const enabled=enable || (previous?.enabled && previous.userId===session.user.id);
    if(!enabled) return false;
    const permissions=await Location.getBackgroundPermissionsAsync();
    if(permissions.status!=='granted') {await stopNative(true);throw new Error('Background location permission is off. Open phone settings to resume sharing.');}
    await SecureStore.setItemAsync(CONTROL,JSON.stringify({enabled:true,userId:session.user.id,loads:active.map(v=>({id:v.id,expiresAt:v.expiresAt}))}));
    try {
      if(!await Location.hasStartedLocationUpdatesAsync(TASK)) await Location.startLocationUpdatesAsync(TASK,{
        accuracy:Location.Accuracy.High, distanceInterval:100, timeInterval:60000,
        deferredUpdatesInterval:60000, pausesUpdatesAutomatically:false, showsBackgroundLocationIndicator:true,
        activityType:Location.ActivityType.AutomotiveNavigation,
        foregroundService:{notificationTitle:'DeepTruck Driver · sharing location',notificationBody:'Sharing for your active loads. Open the app to review or stop.',notificationColor:'#286bc0',killServiceOnDestroy:false}
      });
    } catch(e) {await stopNative(true);throw e;}
    return true;
  });
}
async function collect(locations:Location.LocationObject[]) {
  const {data:{session}}=await supabase.auth.getSession();
  const state=await control(), now=await serverNow();
  if(!session || !canCollect(state,session.user.id,now)) {await stopCollecting(false);return;}
  const offset=now-Date.now(), db=await database();
  // Do not collect a cached fix from a preceding trip/session.
  for(const location of locations) {
    const point:Point={id:Crypto.randomUUID(),latitude:location.coords.latitude,longitude:location.coords.longitude,accuracy:location.coords.accuracy ?? 10000,capturedAt:new Date(location.timestamp+offset).toISOString()};
    if(!validPoint(point,now)) continue;
    const latest=await control();
    if(!canCollect(latest,session.user.id,now)) break;
    await db.runAsync('INSERT OR IGNORE INTO queue (id,user_id,payload,captured_at) VALUES (?,?,?,?)',point.id,session.user.id,JSON.stringify(point),Date.parse(point.capturedAt));
  }
  await db.runAsync('DELETE FROM queue WHERE captured_at < ?',now-86400000);
  await db.runAsync('DELETE FROM queue WHERE id IN (SELECT id FROM queue ORDER BY captured_at DESC LIMIT -1 OFFSET ?)',MAX_QUEUED_POINTS);
  await flushQueue();
}
export function flushQueue():Promise<void> {
  if(flushing) return flushing;
  flushing=(async()=>{
    const {data:{session}}=await supabase.auth.getSession();if(!session)return;
    const db=await database();await db.runAsync('DELETE FROM queue WHERE user_id <> ?',session.user.id);
    for(let batch=0;batch<8;batch++) {
      const rows=await db.getAllAsync<{id:string;payload:string}>('SELECT id,payload FROM queue WHERE user_id = ? ORDER BY captured_at LIMIT 100',session.user.id);
      if(!rows.length) break;
      try {
        const result=await sendPoints(rows.map(v=>JSON.parse(v.payload)));
        // IDs make retries safe if the response is lost after a successful insert.
        await db.runAsync(`DELETE FROM queue WHERE id IN (${rows.map(()=>'?').join(',')})`,...rows.map(v=>v.id));
        await SecureStore.setItemAsync('dt.last-upload',new Date().toISOString());
        await SecureStore.deleteItemAsync('dt.location-error');
        if(result.activeLoads===0) await stopCollecting(false);
      } catch(e) {
        if(e instanceof ApiError && [401,403].includes(e.status)) await stopCollecting(true);
        // Keep transient failures offline; they are retried on the next fix/app resume.
        await SecureStore.setItemAsync('dt.location-error','Location updates are waiting for a connection.');break;
      }
    }
  })().finally(()=>{flushing=null;});
  return flushing;
}
export async function captureNow() {await collect([await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.High})]);}
export async function trackingHealth() {
  const state=await control();
  return {enabled:Boolean(state?.enabled),queued:await queueCount(),lastUpload:await SecureStore.getItemAsync('dt.last-upload'),error:await SecureStore.getItemAsync('dt.location-error')};
}
TaskManager.defineTask<{locations:Location.LocationObject[]}>(TASK,async({data,error})=>{
  if(error) {await SecureStore.setItemAsync('dt.location-error','Location updates stopped. Open the app to check phone permissions.');return;}
  try {if(data?.locations)await collect(data.locations);}catch {await SecureStore.setItemAsync('dt.location-error','Location update failed. Open the app to retry.');}
});
