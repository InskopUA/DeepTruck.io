import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
const require=createRequire(import.meta.url),{loadDriver}=require('./driver-module.cjs');

test('Native tracking updates a stationary phone, migrates old options and respects consent, expiry and pauses',async t=>{
 const clock=Date.now;let now=clock();Date.now=()=>now;t.after(()=>Date.now=clock);
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
 const store=new Map(),uploaded=[],writtenOptions=[],accessibility=new Map();let locked=false;let gpsRequests=0,starts=[],started=false,backgroundTask;
 const user={id:'driver-a'},active={id:'load-a',status:'active',expiresAt:new Date(now+3600000).toISOString()};
 const secure={AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY:4,getItemAsync:async key=>{if(locked&&store.has(key)&&accessibility.get(key)!==4)throw new Error('Keychain locked');return store.get(key)??null},setItemAsync:async(key,value,options)=>{writtenOptions.push(options);store.set(key,value);accessibility.set(key,options.keychainAccessible)},deleteItemAsync:async key=>store.delete(key)};
 const location={Accuracy:{High:4},ActivityType:{AutomotiveNavigation:3},hasServicesEnabledAsync:async()=>true,getForegroundPermissionsAsync:async()=>({status:'granted',ios:{accuracy:'full'}}),getBackgroundPermissionsAsync:async()=>({status:'granted'}),hasStartedLocationUpdatesAsync:async()=>started,startLocationUpdatesAsync:async(_name,options)=>{starts.push(options);started=true},stopLocationUpdatesAsync:async()=>{started=false},getCurrentPositionAsync:async()=>{gpsRequests++;return {timestamp:now,coords:{latitude:40,longitude:-74,accuracy:8}}}};
 const database={execAsync:async sql=>sqlite.exec(sql),runAsync:async(sql,...args)=>sqlite.prepare(sql).run(...args),getFirstAsync:async(sql,...args)=>sqlite.prepare(sql).get(...args),getAllAsync:async(sql,...args)=>sqlite.prepare(sql).all(...args)};
 const api={ApiError:class extends Error{},sendPoints:async points=>{uploaded.push(...points);return {inserted:points.length,activeLoads:1}}};
 const tracking=loadDriver('src/tracking.ts',{'expo-location':location,'expo-task-manager':{defineTask:(_name,fn)=>backgroundTask=fn},'expo-secure-store':secure,'expo-sqlite':{openDatabaseAsync:async()=>database},'expo-crypto':{randomUUID:()=>crypto.randomUUID()},'./auth':{supabase:{auth:{getSession:async()=>({data:{session:{user}}})}}},'./api':api});
 await tracking.syncTracking([active]);await tracking.captureIfDue();assert.equal(gpsRequests,0);assert.equal(starts.length,0,'server active status alone must not start local collection');
 await tracking.syncTracking([active],true);assert.ok(writtenOptions.every(options=>options.keychainAccessible===4),'background controls remain readable after screen lock');assert.equal(starts[0].distanceInterval,0,'stationary updates must not depend on moving 100 meters');
 await tracking.captureIfDue();assert.equal(gpsRequests,1);assert.equal(uploaded.length,1);
 now+=15000;await tracking.captureIfDue();assert.equal(gpsRequests,1,'polling the UI does not acquire GPS every 15 seconds');
 now+=45000;await tracking.captureIfDue();assert.equal(gpsRequests,2);assert.equal(uploaded.length,2);assert.equal(uploaded[0].latitude,uploaded[1].latitude);assert.notEqual(uploaded[0].capturedAt,uploaded[1].capturedAt,'stationary fixes retain their actual new timestamps');
 store.set('dt.tracking.v2.location-options','old-100-meter-filter');await tracking.syncTracking([active]);assert.equal(starts.length,2,'an already running native task receives upgraded options');
 store.delete('dt.tracking.v2.sharing-control');store.set('dt.sharing-control',JSON.stringify({enabled:true,userId:user.id,loads:[{id:active.id,expiresAt:active.expiresAt}]}));await tracking.syncTracking([active]);assert.equal(store.has('dt.sharing-control'),false,'legacy consent is moved to a new accessible Keychain item');locked=true;now+=60000;await tracking.captureIfDue();assert.equal(gpsRequests,3,'a locked-screen callback can read the migrated controls');locked=false;
 const count=uploaded.length;now+=15000;await backgroundTask({data:{locations:[{timestamp:now,coords:{latitude:40,longitude:-74,accuracy:8}}]}});assert.equal(uploaded.length,count,'native callbacks are throttled instead of creating points every second');
 await tracking.stopCollecting(true);now+=60000;await tracking.captureIfDue();assert.equal(gpsRequests,3);assert.equal(started,false);
 await tracking.syncTracking([active],true);user.id='driver-b';now+=60000;await tracking.captureIfDue();assert.equal(gpsRequests,3,'another signed-in driver cannot inherit collection consent');
 user.id='driver-a';now=Date.parse(active.expiresAt)+1;await tracking.captureIfDue();assert.equal(gpsRequests,3,'expired access cannot collect new points');
});
