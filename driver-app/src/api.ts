import * as SecureStore from 'expo-secure-store';
import { supabase } from './auth';
import { fetchJson } from './http';
import type { Load, Point } from './types';

const origin = process.env.EXPO_PUBLIC_TRACKING_API_URL || 'https://yqpeebgmqtqoxumzfrsq.supabase.co/functions/v1/driver-tracking';
export class ApiError extends Error {status:number;constructor(status:number,message:string){super(message);this.status=status;}}
export async function api<T>(path:string,data?:unknown):Promise<T> {
  const {data:{session},error} = await supabase.auth.getSession();
  if(error || !session) throw new ApiError(401,'Please sign in again.');
  const {response,value}=await fetchJson(origin+path,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
  if(!response.ok || value.error) throw new ApiError(response.status,typeof value.error==='string' ? value.error : 'Could not connect. Please try again.');
  if(typeof value.serverNow==='string') {
    const offset=Date.parse(value.serverNow)-Date.now();
    if(Number.isFinite(offset)) await SecureStore.setItemAsync('dt.clock-offset',String(offset));
  }
  return value as T;
}
export const getLoads = () => api<{items:Load[];serverNow:string}>('/driver/loads');
export const loadAction = (id:string,action:'accept'|'decline'|'start'|'pause'|'complete') => api<{load:Load;serverNow:string}>(`/driver/loads/${id}/${action}`,{});
export const pauseAll = () => api<{paused:boolean}>('/driver/pause-all',{});
export const sendPoints = (points:Point[]) => api<{inserted:number;activeLoads:number}>('/driver/locations',{points});
