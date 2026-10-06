import { createClient, type User } from 'npm:@supabase/supabase-js@2.117.2';
import { HttpError, uuid, phone, effectiveStatus, createPayload, locationBatch } from './validation.ts';

const env = (name: string) => Deno.env.get(name) || '';
const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY') || JSON.parse(env('SUPABASE_SECRET_KEYS') || '{}').default;
const db = createClient(env('SUPABASE_URL'),serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
const appUrl = env('VERIFY_APP_URL') || 'https://www.deeptruck.io';
const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});

async function requireUser(req: Request): Promise<User> {
  const token = req.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) throw new HttpError(401,'Please sign in.');
  const {data,error} = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401,'Your session expired. Please sign in again.');
  return data.user;
}
function driverPhone(user: User) {
  if (!user.phone || !user.phone_confirmed_at) throw new HttpError(403,'Verify your phone number to use the driver app.');
  return phone('+' + user.phone.replace(/^\+/,''));
}
function requireDealer(user: User) {
  if (!user.email || !user.email_confirmed_at) throw new HttpError(403,'Sign in with your verified dealership account.');
}
function databaseError(error: {code?: string; message: string} | null) {
  if (!error) return;
  if (error.code === '42501') throw new HttpError(403,error.message);
  if (error.code === '22023' || error.code === '23514') throw new HttpError(400,error.message);
  if (error.code === 'P0001') throw new HttpError(429,error.message);
  console.error('Tracking database error',error.code);
  throw new HttpError(503,'Tracking is temporarily unavailable. Please try again.');
}
async function body(req: Request) {
  const value = await req.text();
  if (value.length > 64000) throw new HttpError(413,'Request is too large.');
  try { const parsed = JSON.parse(value); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(); return parsed; }
  catch { throw new HttpError(400,'Invalid request.'); }
}
const publicPoint = (p: Record<string, unknown>) => ({id:p.id,latitude:p.latitude,longitude:p.longitude,accuracy:p.accuracy,capturedAt:p.captured_at,receivedAt:p.received_at});
function publicLoad(v: Record<string, any>, latestLocation: unknown = null) {
  return {id:v.id,verificationId:v.verification_id,dealerName:v.dealer_name,carrierName:v.carrier_name,carrierDot:v.carrier_dot,
    driverName:v.driver_name,driverPhone:v.driver_phone,title:v.title,vehicles:v.vehicles,pickupAddress:v.pickup_address,
    deliveryAddress:v.delivery_address,plannedAt:v.planned_at,expiresAt:v.expires_at,status:effectiveStatus(v as {status:string;expires_at:string}),
    acceptedAt:v.accepted_at,completedAt:v.completed_at,createdAt:v.created_at,invitationStatus:v.invitation_status,invitedAt:v.invited_at,latestLocation};
}
async function dealerLoad(userId: string, id: string) {
  const {data,error} = await db.from('tracking_loads').select('*').eq('id',uuid(id)).eq('shipper_user_id',userId).maybeSingle();
  databaseError(error); if (!data) throw new HttpError(404,'Load not found.'); return data;
}
async function points(userId: string,id: string,limit = 1) {
  const {data,error} = await db.rpc('tracking_points',{p_shipper:userId,p_load:id,p_limit:limit});
  databaseError(error); return (data || []).map(publicPoint);
}
async function sendInvitation(userId: string,id: string) {
  const {data:load,error} = await db.rpc('tracking_claim_sms',{p_shipper:userId,p_load:id}); databaseError(error);
  const sid = env('TWILIO_ACCOUNT_SID'), secret = env('TWILIO_AUTH_TOKEN'), from = env('TWILIO_FROM_NUMBER');
  if (!sid || !secret || !from || env('TWILIO_TRIAL_TEMPLATE_MODE') === 'true' || env('DEV_SMS_OVERRIDE_PHONE')) {
    await db.from('tracking_loads').update({invitation_status:'failed'}).eq('id',id);
    return {sent:false,message:'Load saved. Driver invitations need production Twilio settings with test overrides disabled.'};
  }
  const message = `${load.dealer_name} invites you to track load "${load.title}" with DeepTruck Driver. Review and accept: ${appUrl}/driver/?invite=${id}`;
  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,{
      method:'POST',headers:{Authorization:`Basic ${btoa(sid + ':' + secret)}`,'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({To:load.driver_phone,From:from,Body:message}),signal:AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error('SMS provider rejected invitation');
    const {error:updateError} = await db.from('tracking_loads').update({invitation_status:'sent',invited_at:new Date().toISOString()}).eq('id',id);
    databaseError(updateError); return {sent:true,message:'Invitation sent.'};
  } catch {
    await db.from('tracking_loads').update({invitation_status:'failed'}).eq('id',id);
    return {sent:false,message:'Load saved, but the SMS could not be sent. You can retry from its tracking card.'};
  }
}

Deno.serve({port:Number(env('PORT') || '8000')},async req => {
  if (req.method === 'OPTIONS') return new Response(null,{status:204,headers:cors});
  try {
    const path = new URL(req.url).pathname.replace(/^.*\/driver-tracking(?=\/|$)/,'') || '/';
    if (req.method === 'GET' && path === '/config') return json({
      iosStoreUrl: env('DRIVER_IOS_STORE_URL'), androidStoreUrl:env('DRIVER_ANDROID_STORE_URL'), appScheme:'deeptruck-driver'
    });
    const user = await requireUser(req);
    if (req.method === 'GET' && path === '/loads') {
      requireDealer(user);
      const {data,error} = await db.rpc('tracking_dealer_loads',{p_shipper:user.id});
      databaseError(error);
      // Each latest point is selected through its own load's access periods.
      const items = (data || []).map((load: Record<string,any>)=>publicLoad(load,load.latest_location ? publicPoint(load.latest_location) : null));
      return json({items,serverNow:new Date().toISOString()});
    }
    if (req.method === 'POST' && path === '/loads') {
      requireDealer(user); const input = await body(req);
      const name = user.user_metadata.company_name || user.user_metadata.dealership_name || user.user_metadata.full_name || 'Your dealership';
      const {data,error} = await db.rpc('tracking_create',{p_shipper:user.id,p_verification:uuid(input.verificationId,'carrier verification'),p_request:uuid(input.clientRequestId,'request ID'),p_payload:createPayload(input,name)});
      databaseError(error);
      let invitation = {sent:data.load.invitation_status === 'sent',message:'Load already saved.'};
      if (data.created) {
        try { invitation = await sendInvitation(user.id,data.load.id); }
        catch (e) { invitation = {sent:false,message:e instanceof HttpError ? e.message : 'Load saved. Please retry sending its invitation.'}; }
      }
      const load = await dealerLoad(user.id,data.load.id);
      return json({load:publicLoad(load),invitation},data.created ? 201 : 200);
    }
    const dealerRoute = path.match(/^\/loads\/([^/]+)(?:\/(points|resend|complete|cancel))?$/);
    if (dealerRoute) {
      requireDealer(user); const [,id,action] = dealerRoute; const load = await dealerLoad(user.id,id);
      if (req.method === 'GET' && action === 'points') return json({points:await points(user.id,id,500)});
      if (req.method === 'GET' && !action) return json({load:publicLoad(load,(await points(user.id,id))[0] || null)});
      if (req.method === 'POST' && action === 'resend') return json({invitation:await sendInvitation(user.id,id)});
      if (req.method === 'POST' && ['complete','cancel'].includes(action || '')) {
        const {data,error} = await db.rpc('tracking_action',{p_actor:user.id,p_phone:'',p_load:id,p_action:action,p_driver:false}); databaseError(error);
        return json({load:publicLoad(data)});
      }
    }
    if (path.startsWith('/driver/')) {
      const number = driverPhone(user);
      if (req.method === 'GET' && path === '/driver/loads') {
        const {data,error} = await db.from('tracking_loads').select('*').or(`driver_user_id.eq.${user.id},and(driver_user_id.is.null,driver_phone.eq.${number},status.eq.pending)`).order('created_at',{ascending:false}).limit(100);
        databaseError(error);
        return json({items:(data || []).map(v => publicLoad(v)),serverNow:new Date().toISOString()});
      }
      if (req.method === 'POST' && path === '/driver/pause-all') {
        const {error} = await db.rpc('tracking_pause_all',{p_driver:user.id}); databaseError(error); return json({paused:true});
      }
      if (req.method === 'POST' && path === '/driver/locations') {
        const {data,error} = await db.rpc('tracking_ingest',{p_driver:user.id,p_points:locationBatch(await body(req))}); databaseError(error); return json(data);
      }
      const actionRoute = path.match(/^\/driver\/loads\/([^/]+)\/(accept|decline|start|pause|complete)$/);
      if (req.method === 'POST' && actionRoute) {
        const {data,error} = await db.rpc('tracking_action',{p_actor:user.id,p_phone:number,p_load:uuid(actionRoute[1]),p_action:actionRoute[2],p_driver:true}); databaseError(error);
        return json({load:publicLoad(data),serverNow:new Date().toISOString()});
      }
    }
    return json({error:'Not found.'},404);
  } catch (e) {
    if (e instanceof HttpError) return json({error:e.message},e.status);
    console.error('Tracking request failed',e instanceof Error ? e.name : 'Unknown error');
    return json({error:'Tracking is temporarily unavailable. Please try again.'},500);
  }
});
