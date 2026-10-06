import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadPresentation,effectiveLoad,initialHealth,initialAccess} from '../driver-app/src/driver-state.ts';
const now=Date.now(),load={status:'active',expiresAt:new Date(now+3600000).toISOString()},access={...initialAccess,foreground:true,background:true},health={...initialHealth,enabled:true,lastCapture:new Date(now).toISOString()};
test('Driver status reflects actual permission, GPS and delivery state',()=>{
 assert.equal(loadPresentation(load,health,initialAccess,now).label,'Location access needed');
 assert.equal(loadPresentation(load,initialHealth,access,now).label,'Tracking stopped');
 assert.equal(loadPresentation(load,{...health,lastCapture:null},access,now).label,'Waiting for GPS');
 assert.equal(loadPresentation(load,{...health,queued:3},access,now).label,'Waiting for connection');
 assert.equal(loadPresentation(load,health,access,now).label,'Sharing location');
 assert.equal(loadPresentation(load,health,access,now+360000).label,'Waiting for GPS update');
 assert.equal(loadPresentation({...load,status:'pending'},initialHealth,initialAccess,now).action,'Accept & start tracking');
 assert.equal(loadPresentation({...load,status:'accepted'},initialHealth,initialAccess,now).action,'Start tracking');
 assert.equal(loadPresentation({...load,status:'paused'},health,access,now).label,'Paused');
 const expired=effectiveLoad(load,now+7200000);assert.equal(expired.status,'expired');assert.equal(loadPresentation(expired,health,access,now).action,null);
});
