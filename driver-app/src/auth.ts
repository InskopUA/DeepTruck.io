import 'react-native-url-polyfill/auto';
import * as SecureStore from 'expo-secure-store';
import { createClient, processLock } from '@supabase/supabase-js';

// Split larger auth sessions into encrypted chunks for iOS Keychain limits.
const options = {keychainAccessible:SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY};
const safeKey = (key:string) => 'dt.'+key.replace(/[^a-zA-Z0-9._-]/g,'_');
export const secureStorage = {
  async getItem(key:string) {
    const base = safeKey(key), meta = await SecureStore.getItemAsync(base,options);
    if (!meta) return null;
    const n = Number(meta); if (!Number.isInteger(n) || n<1 || n>100) return null;
    const pieces = await Promise.all(Array.from({length:n},(_,i)=>SecureStore.getItemAsync(base+'.'+i,options)));
    return pieces.some(p=>p===null) ? null : pieces.join('');
  },
  async setItem(key:string,value:string) {
    const base = safeKey(key), old = Number(await SecureStore.getItemAsync(base,options)) || 0;
    // URI encoding gives predictable ASCII byte lengths, including names.
    const encoded = encodeURIComponent(value);
    const pieces = encoded.match(/.{1,1500}/g) || [''];
    for(let i=0;i<pieces.length;i++) await SecureStore.setItemAsync(base+'.'+i,pieces[i],options);
    await SecureStore.setItemAsync(base,String(pieces.length),options);
    for(let i=pieces.length;i<old;i++) await SecureStore.deleteItemAsync(base+'.'+i,options);
  },
  async removeItem(key:string) {
    const base=safeKey(key), n=Number(await SecureStore.getItemAsync(base,options)) || 0;
    await SecureStore.deleteItemAsync(base,options);
    for(let i=0;i<n;i++) await SecureStore.deleteItemAsync(base+'.'+i,options);
  }
};
const authStorage = {...secureStorage,async getItem(key:string){const value=await secureStorage.getItem(key);return value===null?null:decodeURIComponent(value);}};
export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://yqpeebgmqtqoxumzfrsq.supabase.co',
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_GaoXNE-0hGpMDv3cMy3QDA_UfQuvvIM',
  {auth:{storage:authStorage,autoRefreshToken:true,persistSession:true,detectSessionInUrl:false,lock:processLock}}
);
