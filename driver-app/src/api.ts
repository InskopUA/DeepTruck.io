import * as SecureStore from 'expo-secure-store';
import { supabase } from './auth';
import type { Load, Point } from './types';

const origin = process.env.EXPO_PUBLIC_TRACKING_API_URL || 'https://yqpeebgmqtqoxumzfrsq.supabase.co/functions/v1/driver-tracking';
export class ApiError extends Error {status:number;constructor(status:number,message:string){super(message);this.status=status;}}
export async function api<T>(path:string,data?:unknown):Promise<T> {
  const {data:{session},error} = await supabase.auth.getSession();
  if(error || !session) throw new ApiError(401,'Please sign in again.');
  const response=await fetch(origin+path,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(20000)});
  const value=await response.json().catch(()=>({}));
  if(!response.ok || value.error) throw new ApiError(response.status,value.error || 'Could not connect. Please try again.');
  if(value.serverNow) {
    const offset=Date.parse(value.serverNow)-Date.now();
    if(Number.isFinite(offset)) await SecureStore.setItemAsync('dt.clock-offset',String(offset));
  }
  return value;
}
export const getLoads = () => api<{items:Load[];serverNow:string}>('/driver/loads');
export const loadAction = (id:string,action:'accept'|'decline'|'start'|'pause'|'complete') => api<{load:Load;serverNow:string}>(`/driver/loads/${id}/${action}`,{});
export const pauseAll = () => api<{paused:boolean}>('/driver/pause-all',{});
export const sendPoints = (points:Point[]) => api<{inserted:number;activeLoads:number}>('/driver/locations',{points});
